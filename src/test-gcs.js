const { Storage } = require('@google-cloud/storage');
const storageClient = new Storage({
    projectId: process.env.GCS_PROJECT_ID || 'efvframework'
});

async function testStorage() {
    try {
        console.log('Testing GCS connection...');
        const bucketMatch = await storageClient.bucket('efvbucket').exists();
        console.log('Bucket exists:', bucketMatch[0]);
    } catch (error) {
        console.error('Error connecting to GCS:', error);
    }
}
testStorage();
