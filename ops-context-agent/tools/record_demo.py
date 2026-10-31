"""Record a real model-backed demo. Requires optional Playwright, not app runtime."""
import argparse
import hashlib
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def record(url, browser_name):
    docs = ROOT / 'docs'
    shots = docs / 'screenshots'
    shots.mkdir(parents=True, exist_ok=True)
    temp_video = ROOT / 'artifacts' / 'recording'
    temp_video.mkdir(parents=True, exist_ok=True)
    requests, responses, errors = [], [], []
    started = time.monotonic()
    with sync_playwright() as playwright:
        options = {'headless': True}
        if browser_name != 'chromium':
            options['channel'] = browser_name
        browser = playwright.chromium.launch(**options)
        context = browser.new_context(
            viewport={'width': 1440, 'height': 1040},
            record_video_dir=str(temp_video),
            record_video_size={'width': 1440, 'height': 1040},
        )
        page = context.new_page()
        page.set_default_timeout(240000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append(request.url) if '/api/' in request.url else None)
        page.on('response', lambda response: responses.append({'endpoint': response.url.rsplit('/', 1)[-1], 'status': response.status}) if '/api/' in response.url else None)

        def caption(title, text, seconds=4):
            print(title, flush=True)
            page.evaluate('''({title,text}) => {
                const banner = document.querySelector('#recordingCaption');
                banner.replaceChildren();
                const heading = document.createElement('b'); heading.textContent=title;
                const detail = document.createElement('span'); detail.textContent=text;
                banner.append(heading,detail);
            }''', {'title': title, 'text': text})
            page.wait_for_timeout(seconds * 1000)

        def screenshot(name):
            page.locator('#recordingCaption').evaluate('(node)=>node.style.visibility="hidden"')
            page.screenshot(path=str(shots / name))
            page.locator('#recordingCaption').evaluate('(node)=>node.style.visibility="visible"')

        try:
            page.goto(url, wait_until='networkidle')
            # Reserve a caption strip below the app; never obscure product controls.
            page.add_style_tag(content='''
                .main{height:calc(100dvh - 88px)!important}
                .sidebar{bottom:88px!important}
                #recordingCaption{position:fixed;bottom:0;left:0;right:0;height:88px;
                    z-index:1000;background:#101827;color:#fff;padding:12px 28px;
                    display:flex;flex-direction:column;justify-content:center;
                    font:18px/1.65 "Microsoft YaHei",sans-serif;pointer-events:none}
                #recordingCaption b{color:#c2ccff;font-size:20px}
                #recordingCaption span{color:#eef3ff}
            ''')
            page.evaluate('''() => {const node=document.createElement('div');node.id='recordingCaption';document.body.append(node);}''')
            caption('ContextOps · 会后任务专家助手', '龚志球、曹琬廑、喻林｜从会议纪要到我的行动清单，再到按需专家分析', 5)
            page.locator('#importMinutes').click()
            page.locator('#minutesPerson').fill('周宁')
            page.locator('#minutesFile').set_input_files(str(ROOT / 'examples' / 'meeting-demo.txt'))
            caption('01 / 导入纪要', '导入虚构会议文本，填写本人姓名。无需先邀请专家。', 5)
            screenshot('01-import.png')
            caption('真实模型调用：提取本人任务', '点击提取后，后端将纪要与姓名发送给当前配置的 GPT；保留实际等待过程。', 2)
            with page.expect_response('**/api/minutes') as pending:
                page.locator('#extractTasks').click()
            extraction_response = pending.value
            extraction = extraction_response.json()
            if extraction_response.status != 200:
                raise RuntimeError('Task extraction failed; see the app error. No mock fallback was used.')
            page.locator('.task-card').first.wait_for()
            task_count = page.locator('.task-card').count()
            page.locator('.task-source summary').first.click()
            caption('02 / 确认我的任务', '查看负责人、截止时间、分工状态与逐字原文依据；模型整理的结果仍需本人核对。', 7)
            screenshot('02-tasks.png')
            tasks = extraction['meeting']['tasks']
            migration = next((task for task in tasks if task['expertId'] == 'database'), None)
            if migration is None:
                migration = next((task for task in tasks if '验收' in task['title'] or '迁移' in task['title']), None)
            if migration is None:
                raise RuntimeError('The model did not return the migration task; review its result before recording.')
            page.locator('[data-task-expert="' + migration['id'] + '"]').click()
            page.locator('[data-expert-id="database"]').click()
            caption('03 / 按需邀请专家', '选中迁移验收任务，再选择数据库专家。可以自行处理的任务无需专家介入。', 5)
            page.locator('#confirmInvite').click()
            assert not any('/api/chat' in item for item in requests), 'Expert join unexpectedly requested an answer'
            caption('添加专家不会主动回答', '此时只载入上下文并准备提问；由本人决定是否发送。', 5)
            page.locator('#meetingInput').fill('@')
            page.locator('#memberMentions').wait_for(state='visible')
            caption('输入 @ 才提示参会成员', '在讨论区明确指定专家，角色名以蓝色高亮显示。', 4)
            page.locator('#meetingInput').fill('@数据库专家 请用150字以内，列出这项任务的两个验收关注点、一个待确认问题和下一步。区分纪要事实与建议。')
            caption('真实模型调用：针对选中任务分析', '发送后，专家结合原始纪要、选中的任务与近期讨论回答。', 3)
            with page.expect_response('**/api/chat') as pending:
                page.locator('#sendMeeting').click()
            answer_response = pending.value
            answer = answer_response.json()
            if answer_response.status != 200:
                raise RuntimeError('Expert call failed; see the app error. No mock fallback was used.')
            page.locator('#agentContent .answer-card.ready').wait_for()
            page.wait_for_timeout(2800)
            caption('04 / 查看任务分析', '真实回答保留任务关联，区分已知事实、缺失信息和下一步建议。', 8)
            screenshot('03-expert.png')
            page.locator('#answerSearch').fill('验收')
            caption('05 / 搜索记录与固定工具区', '按关键词检索当前专家的任务与问答；滚动记录时，参会专家和搜索框保持固定。', 5)
            before = page.locator('#answerSearch').bounding_box()['y']
            page.locator('#agentContent').evaluate('(node)=>node.scrollTop=node.scrollHeight')
            page.wait_for_timeout(1500)
            after = page.locator('#answerSearch').bounding_box()['y']
            assert abs(before - after) < 2, 'Search controls moved while scrolling'
            screenshot('04-search.png')
            page.wait_for_timeout(3500)
            page.locator('#clearAnswerSearch').click()
            page.locator('#thread').evaluate('(node)=>node.scrollTop=0')
            page.locator('[data-complete-task]').first.check()
            caption('从纪要到行动，专业协助按需发生', '可以勾选完成任务。当前版本按页面会话保存，刷新后需要重新导入。', 6)
            caption('ContextOps · 可运行的 Web 原型', '标准 Python 启动，无前端构建依赖｜完整源码、运行说明与演示材料随包提供', 5)
            if errors:
                raise RuntimeError('Browser errors occurred during the recording')
            metadata = {
                'recorded_on': time.strftime('%Y-%m-%d'),
                'viewport': {'width': 1440, 'height': 1040},
                'real_model_requests': True,
                'extraction_model': extraction.get('model'),
                'expert_model': answer.get('model'),
                'personal_task_count': task_count,
                'http_results': responses,
                'no_chat_on_expert_join': True,
                'fixed_search_verified': True,
                'browser_errors': errors,
                'caption_only_no_audio': True,
            }
        finally:
            video = page.video
            context.close()
            browser.close()
        target = docs / '演示视频.webm'
        video.save_as(str(target))
        video.delete()
    metadata['recording_elapsed_seconds'] = round(time.monotonic() - started, 1)
    metadata['webm_bytes'] = target.stat().st_size
    metadata['webm_sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
    (docs / 'video-metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://localhost:5175')
    parser.add_argument('--browser', default='msedge', choices=['msedge', 'chrome', 'chromium'])
    arguments = parser.parse_args()
    record(arguments.url, arguments.browser)
