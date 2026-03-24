const fs = require('fs').promises;
const path = require('path');

class JsonDB {
    constructor(filename) {
        this.filepath = path.join(__dirname, '../data', filename);
    }

    async _read() {
        try {
            const data = await fs.readFile(this.filepath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    async _write(data) {
        await fs.writeFile(this.filepath, JSON.stringify(data, null, 2), 'utf8');
    }

    async getAll() {
        return await this._read();
    }

    async getById(id) {
        const data = await this._read();
        return data.find(item => (item._id || item.id) === id);
    }

    async create(item) {
        const data = await this._read();
        const newItem = {
            ...item,
            _id: item._id || item.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
            createdAt: new Date(),
            updatedAt: new Date()
        };
        data.push(newItem);
        await this._write(data);
        return newItem;
    }

    async update(id, updates) {
        const data = await this._read();
        const index = data.findIndex(item => (item._id || item.id) === id);
        if (index === -1) return null;

        data[index] = {
            ...data[index],
            ...updates,
            updatedAt: new Date()
        };
        await this._write(data);
        return data[index];
    }

    async delete(id) {
        const data = await this._read();
        const filtered = data.filter(item => (item._id || item.id) !== id);
        await this._write(filtered);
        return true;
    }

    async write(fullData) {
        await this._write(fullData);
    }
}

module.exports = JsonDB;
