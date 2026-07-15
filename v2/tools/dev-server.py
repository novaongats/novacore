"""
NOVA Core v2 — 開発用HTTPサーバー（キャッシュ無効版）

python -m http.server はキャッシュ制御ヘッダーを送らないため、
Chrome のヒューリスティックキャッシュで旧モジュールが残り、
編集後に新旧モジュールが混在してアプリが壊れる（プレビューが
押せない等）。このサーバーは Cache-Control: no-cache を送るので
常に再検証され、ハードリロード不要で最新が反映される。

使い方:  python v2/tools/dev-server.py [port] [directory]
既定:    port 8321, directory = カレント
"""
import sys
import http.server
import functools


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # no-cache = 使う前に必ずサーバーへ再検証（304なら転送なしで高速）
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 静かに


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8321
    directory = sys.argv[2] if len(sys.argv) > 2 else '.'
    handler = functools.partial(NoCacheHandler, directory=directory)
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler) as httpd:
        print(f'dev-server (no-cache) on http://localhost:{port}/ dir={directory}')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
