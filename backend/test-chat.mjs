import http from 'http';

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/chat/stream?query=hello&mode=agentic',
  method: 'GET',
  headers: {
    // Need to bypass auth or pass token... Wait, the route has JwtAuthGuard!
  }
});
req.end();
