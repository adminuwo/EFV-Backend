const { Cashfree } = require('cashfree-pg');
const instance = new Cashfree();
console.log('Instance properties:', Object.getOwnPropertyNames(Object.getPrototypeOf(instance)));
