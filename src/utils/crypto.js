const crypto = require('crypto');

function generateNumericCode(length = 16) {
  let code = '';
  while (code.length < length) {
    code += crypto.randomInt(0, 10).toString();
  }
  return code;
}

module.exports = { generateNumericCode };