const { MongoClient } = require('mongodb');

async function check(url) {
    const client = new MongoClient(url);
    try {
        await client.connect();
        const dbs = await client.db().admin().listDatabases();
        console.log(`Connected to ${url}`);
        console.log('DBs:', dbs.databases.map(d => d.name).join(', '));
    } catch (err) {
        console.log(`Failed to connect to ${url}: ${err.message}`);
    } finally {
        await client.close();
    }
}

async function run() {
    console.log('--- Checking 127.0.0.1 (IPv4) ---');
    await check('mongodb://127.0.0.1:27017');
    console.log('\n--- Checking [::1] (IPv6) ---');
    await check('mongodb://[::1]:27017');
}

run();
