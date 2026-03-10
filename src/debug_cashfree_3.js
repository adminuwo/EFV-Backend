const pkg = require('cashfree-pg');
const Cashfree = pkg.Cashfree;

console.log('pkg.Cashfree is type:', typeof Cashfree);
console.log('pkg.Cashfree properties:', Object.getOwnPropertyNames(Cashfree));

Cashfree.XClientId = "test";
console.log('Set XClientId, now properties:', Object.getOwnPropertyNames(Cashfree));
