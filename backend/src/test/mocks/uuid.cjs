const { randomUUID } = require('crypto');

const uuid = {
  MAX: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  NIL: '00000000-0000-0000-0000-000000000000',
  parse: (value) => Buffer.from(String(value).replace(/-/g, ''), 'hex'),
  stringify: (value) => Buffer.from(value).toString('hex'),
  validate: (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      String(value),
    ),
  v1: randomUUID,
  v3: randomUUID,
  v4: randomUUID,
  v5: randomUUID,
  v6: randomUUID,
  v7: randomUUID,
};

module.exports = uuid;
module.exports.default = uuid;
