/**
 * Enhanced JSON Model Adapter to mimic Mongoose behavior.
 * Returns a Query-like object for chaining (.populate, .sort, etc.)
 */
class JsonModel {
    static _attachSave(obj, dbInstance) {

        if (!obj) return null;
        if (Array.isArray(obj)) {
            return obj.map(item => JsonModel._attachSave(item, dbInstance));
        }

        Object.defineProperty(obj, 'save', {
            value: async function () {
                const id = this._id || this.id;
                // Create a plain object copy (avoids non-enumerable save interfering)
                // Use a try-catch to catch stringification errors (circular refs)
                let plainCopy;
                try {
                    plainCopy = JSON.parse(JSON.stringify(this));
                } catch (e) {
                    console.error('❌ JSON DB Stringify Error (Circular?):', e.message);
                    throw e;
                }

                if (id) {
                    const result = await dbInstance.update(id, plainCopy);
                    if (result) Object.assign(this, result);
                    return this;
                } else {
                    const created = await dbInstance.create(plainCopy);
                    Object.assign(this, created);
                    return this;
                }
            },
            enumerable: false,
            writable: true,
            configurable: true
        });

        Object.defineProperty(obj, 'markModified', {
            value: function (field) {
                // In JSON DB mode, simple mutations work directly.
                // This is a no-op to maintain Mongoose compatibility.
                return;
            },
            enumerable: false,
            writable: true,
            configurable: true
        });

        Object.defineProperty(obj, 'toObject', {
            value: function () {
                // Return a clean clone of the instance data
                return JSON.parse(JSON.stringify(this));
            },
            enumerable: false,
            writable: true,
            configurable: true
        });

        return obj;
    }

    static createModel(filename) {
        const JsonDB = require('../utils/jsonDB');
        const db = new JsonDB(filename);

        class Query {
            constructor(promiseOrResult) {
                this.promise = Promise.resolve(promiseOrResult);
            }
            populate() { return this; }
            sort(options) {
                this.promise = this.promise.then(results => {
                    if (!Array.isArray(results)) return results;
                    return [...results].sort((a, b) => {
                        for (let [key, val] of Object.entries(options)) {
                            if (a[key] > b[key]) return val === -1 ? -1 : 1;
                            if (a[key] < b[key]) return val === -1 ? 1 : -1;
                        }
                        return 0;
                    });
                });
                return this;
            }
            limit(n) {
                this.promise = this.promise.then(results => Array.isArray(results) ? results.slice(0, n) : results);
                return this;
            }
            select() { return this; }
            skip(n) {
                this.promise = this.promise.then(results => Array.isArray(results) ? results.slice(n) : results);
                return this;
            }
            lean() { return this; }
            async exec() { return this.promise; }
            then(resolve, reject) {
                return this.promise.then(resolve, reject);
            }
        }

        return class ModelInstance {
            constructor(data = {}) {
                Object.assign(this, data);
                JsonModel._attachSave(this, db);
            }

            static find(query = {}) {
                const run = async () => {
                    const data = await db.getAll();
                    const matchQuery = (item, queryObj) => {
                        return Object.entries(queryObj).every(([key, value]) => {
                            if (key === '$or' && Array.isArray(value)) {
                                return value.some(subQuery => matchQuery(item, subQuery));
                            }
                            if (key === '$and' && Array.isArray(value)) {
                                return value.every(subQuery => matchQuery(item, subQuery));
                            }
                            let itemValue = item;
                            if (key.includes('.')) {
                                const parts = key.split('.');
                                for (const part of parts) {
                                    itemValue = itemValue ? itemValue[part] : undefined;
                                }
                            } else {
                                itemValue = item[key];
                            }
                            if (value instanceof RegExp) return itemValue && value.test(itemValue);
                            return String(itemValue) == String(value);
                        });
                    };

                    let results = data;
                    if (Object.keys(query).length > 0) {
                        results = data.filter(item => matchQuery(item, query));
                    }
                    return JsonModel._attachSave(results, db);
                };
                return new Query(run());
            }

            static findOne(query) {
                const run = async () => {
                    const results = await this.find(query);
                    return results[0] || null;
                };
                return new Query(run());
            }

            static findById(id) {
                if (!id) return new Query(null);
                const run = async () => {
                    const item = await db.getById(id.toString());
                    return JsonModel._attachSave(item, db);
                };
                return new Query(run());
            }

            static findByIdAndUpdate(id, updates, options = {}) {
                if (!id) return new Query(null);
                const run = async () => {
                    const updated = await db.update(id.toString(), updates);
                    return JsonModel._attachSave(updated, db);
                };
                return new Query(run());
            }

            static findOneAndUpdate(query, updatesOrFn, options = {}) {
                const run = async () => {
                    let item = await this.findOne(query);
                    if (item) {
                        const result = await db.update(item._id || item.id, updatesOrFn);
                        return JsonModel._attachSave(result, db);
                    } else if (options.upsert) {
                        const data = typeof updatesOrFn === 'function' ? updatesOrFn(query) : { ...query, ...updatesOrFn };
                        return await this.create(data);
                    }
                    return null;
                };
                return new Query(run());
            }

            static async updateMany(query, updates) {
                const data = await db.getAll();
                let modifiedCount = 0;
                const updatedData = data.map(item => {
                    const matches = Object.entries(query).every(([key, value]) => {
                        return item[key] == value;
                    });
                    if (matches) {
                        modifiedCount++;
                        return { ...item, ...updates.$set }; // Simple $set support
                    }
                    return item;
                });
                await db.write(updatedData);
                return { modifiedCount };
            }

            static async create(data) {
                const items = Array.isArray(data) ? data : [data];
                const createdItems = [];
                for (const item of items) {
                    createdItems.push(await db.create(item));
                }
                const attached = JsonModel._attachSave(createdItems, db);
                return Array.isArray(data) ? attached : attached[0];
            }

            static async deleteMany(query = {}) {
                if (Object.keys(query).length === 0) {
                    await db.write([]);
                    return { deletedCount: 'all' };
                }
                const data = db.getAll();
                const filtered = data.filter(item => {
                    return !Object.entries(query).every(([key, value]) => item[key] == value);
                });
                await db.write(filtered);
                return { deletedCount: data.length - filtered.length };
            }

            static findByIdAndDelete(id) {
                const run = async () => {
                    const item = await this.findById(id);
                    if (item) {
                        await db.delete(id.toString());
                        return item;
                    }
                    return null;
                };
                return new Query(run());
            }

            static findOneAndDelete(query) {
                const run = async () => {
                    const item = await this.findOne(query);
                    if (item) {
                        db.delete((item._id || item.id).toString());
                        return item;
                    }
                    return null;
                };
                return new Query(run());
            }
        };
    }
}

module.exports = {
    User: JsonModel.createModel('users.json'),
    Product: JsonModel.createModel('products.json'),
    Purchase: JsonModel.createModel('purchases.json'),
    Order: JsonModel.createModel('orders.json'),
    Cart: JsonModel.createModel('cart.json'),
    UserProgress: JsonModel.createModel('progress.json'),
    AudiobookProgress: JsonModel.createModel('audiobook_progress.json'),
    DigitalLibrary: JsonModel.createModel('digital_library.json'),
    Payment: JsonModel.createModel('payments.json'),
    Shipment: JsonModel.createModel('shipments.json'),
    Coupon: JsonModel.createModel('coupons.json'),
    Support: JsonModel.createModel('support.json'),
    Partner: JsonModel.createModel('partners.json'),
    PartnerMessage: JsonModel.createModel('partner_messages.json'),
    ReturnRequest: JsonModel.createModel('return_requests.json'),
    OrderCancellation: JsonModel.createModel('order_cancellations.json'),
    BotLead: JsonModel.createModel('bot_leads.json'),
    ChatConversation: JsonModel.createModel('chat_conversations.json'),
    Job: JsonModel.createModel('jobs.json'),
    NotificationLog: JsonModel.createModel('notification_logs.json'),
    SystemSettings: JsonModel.createModel('system_settings.json')
};
