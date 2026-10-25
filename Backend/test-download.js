const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 4000,
  path: '/api/admin/products/bulk-template',
  method: 'GET',
  headers: {
    // Injecting a fake admin by bypassing middleware temporarily would be hard.
    // Instead, let's just make the request and see if it fails on headers/cors/etc.
  }
}, (res) => {
  console.log('STATUS:', res.statusCode);
  console.log('HEADERS:', res.headers);
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.end();
