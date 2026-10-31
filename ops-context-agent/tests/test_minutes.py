import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import server


class MinutesTests(unittest.TestCase):
    def setUp(self):
        self.person = '周宁'
        self.minutes = '周宁负责整理需求，周五提交。张三负责上线。'
        self.task = dict(title='整理需求', sourceQuote='周宁负责整理需求，周五提交。', owner='周宁', involvement='负责人', deadline='周五', priority='unspecified', expertId='product', needsConfirmation=False)

    def parse(self, tasks):
        return server.parse_minutes({'output_text': json.dumps({'tasks': tasks, 'participants': ['周宁', '张三', '虚构成员']})}, self.minutes, self.person)

    def test_verbatim_personal_assignment(self):
        result = self.parse([self.task])
        self.assertEqual(result['tasks'][0]['sourceQuote'], self.task['sourceQuote'])
        self.assertEqual(result['tasks'][0]['deadline'], '周五')
        self.assertEqual(result['tasks'][0]['involvement'], '负责人')
        self.assertFalse(result['tasks'][0]['needsConfirmation'])
        self.assertEqual(result['participants'], ['周宁', '张三'])

    def test_excludes_other_people_and_invented_quotes(self):
        result = self.parse([dict(self.task, sourceQuote='张三负责上线。'), dict(self.task, sourceQuote='周宁负责上线。'), None])
        self.assertEqual(result['tasks'], [])
        self.assertTrue(result['notice'])

    def test_empty_and_malformed_results(self):
        self.assertEqual(self.parse([])['tasks'], [])
        for raw in [{'output_text': 'not json'}, {'output_text': '{}'}, {'status': 'incomplete', 'output_text': '{}'}]:
            with self.assertRaises(server.ModelError):
                server.parse_minutes(raw, self.minutes, self.person)

    def test_invalid_enum_values_are_normalized(self):
        result = self.parse([dict(self.task, priority=[], expertId={}, involvement=[])])['tasks'][0]
        self.assertEqual(result['priority'], 'unspecified')
        self.assertEqual(result['involvement'], '待确认')
        self.assertEqual(result['expertId'], 'custom')

    def test_extraction_uses_responses_and_configured_model(self):
        class Response:
            def __enter__(inner): return inner
            def __exit__(inner, *args): pass
            def read(inner): return json.dumps({'output_text': json.dumps({'tasks': [self.task]})}).encode()
        with patch.object(server, 'model_settings', return_value={'api_key': 'test-only', 'base_url': 'https://example.invalid/v1', 'model': 'gpt-6.1-sol'}), patch.object(server.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = Response()
            result = server.ask_model({'task': 'extract_tasks', 'person': self.person, 'minutes': self.minutes})
            request = opener.return_value.open.call_args.args[0]
            sent = json.loads(request.data)
            self.assertEqual(request.full_url, 'https://example.invalid/v1/responses')
            self.assertEqual(sent['model'], 'gpt-6.1-sol')
            self.assertFalse(sent['store'])
            self.assertEqual(json.loads(sent['input'])['person'], self.person)
            self.assertEqual(len(result['meeting']['tasks']), 1)


class RouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.httpd.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def post(self, path, payload):
        request = urllib.request.Request(self.url + path, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_validation_prevents_model_calls(self):
        with patch.object(server, 'ask_model') as model:
            for data in [[], {}, {'minutes': 'text', 'person': ''}, {'minutes': 'a' * 30001, 'person': 'name'}]:
                self.assertEqual(self.post('/api/minutes', data)[0], 400)
            model.assert_not_called()

    def test_route_isolates_extraction_from_questions(self):
        with patch.object(server, 'ask_model', return_value={'meeting': {'tasks': []}}) as model:
            self.assertEqual(self.post('/api/minutes', {'minutes': ' notes ', 'person': ' user ', 'task': 'question'})[0], 200)
            self.assertEqual(model.call_args.args[0], {'task': 'extract_tasks', 'minutes': 'notes', 'person': 'user'})
            self.post('/api/chat', {'question': 'question', 'task': 'extract_tasks'})
            self.assertEqual(model.call_args.args[0]['task'], 'question')


if __name__ == '__main__':
    unittest.main()
