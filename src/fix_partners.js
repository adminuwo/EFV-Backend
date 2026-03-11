require('dotenv').config();
const { Partner } = require('./models');

async function fixPartners() {
    try {
        console.log('Fixing partners data...');
        const partners = await Partner.find();
        console.log(`Found ${partners.length} partners.`);

        for (const partner of partners) {
            let updated = false;
            if (partner.isActive === undefined || partner.isActive === false) {
                partner.isActive = true;
                updated = true;
            }
            if (partner.isActivated === undefined) {
                partner.isActivated = false;
                updated = true;
            }
            
            if (updated) {
                await partner.save();
                console.log(`✅ Updated partner: ${partner.name} (${partner.email})`);
            } else {
                console.log(`ℹ️ Partner ${partner.name} already correct.`);
            }
        }
        console.log('Done!');
        process.exit(0);
    } catch (error) {
        console.error('Error fixing partners:', error);
        process.exit(1);
    }
}

fixPartners();
