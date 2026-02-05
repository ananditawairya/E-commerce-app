const mongoose = require('mongoose');

async function checkDBs() {
    try {
        const uri = 'mongodb://localhost:27017';
        const client = await mongoose.connect(uri);
        const admin = client.connection.db.admin();
        const dbs = await admin.listDatabases();

        console.log('Databases found:');
        for (const dbInfo of dbs.databases) {
            console.log(`- ${dbInfo.name}`);
            const db = client.connection.useDb(dbInfo.name);
            const collections = await db.db.listCollections().toArray();
            for (const coll of collections) {
                const count = await db.db.collection(coll.name).countDocuments();
                console.log(`  * ${coll.name} (${count} docs)`);
            }
        }

        await mongoose.disconnect();
    } catch (err) {
        console.error('Error:', err);
    }
}

checkDBs();
