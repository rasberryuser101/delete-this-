// This CI sandbox hides network interfaces from Node's native OS API.
// Normal Cloudflare deployments do not use this test-only shim.
const os = require('node:os');
const original = os.networkInterfaces;
os.networkInterfaces = function () {
  try { return original(); } catch { return { lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }] }; }
};
