const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const SPREADSHEET_ID = '1b374pCqGDwBXTjClpDwYFxeSS2w3nfOLOja0iQlehi8';
const SHEET_NAME = 'Sheet1'; // Change if your sheet tab has a different name
const KEY_FILE = path.join(__dirname, '../../google-sheets-key.json');

async function getAuthClient() {
    if (!fs.existsSync(KEY_FILE)) {
        throw new Error('google-sheets-key.json not found in backend root folder');
    }
    const auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    return auth.getClient();
}

/**
 * Append a row to the Contact Form Google Sheet
 */
async function appendContactRow({ name, email, message, subject }) {
    try {
        const authClient = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        // Format date and time in IST
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });

        // Check if header row exists, add if not
        const getRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A1:E1`
        });

        const firstRow = getRes.data.values?.[0] || [];
        if (firstRow.length === 0 || firstRow[0] !== 'Name') {
            // Add header row
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A1:E1`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [['Name', 'Email', 'Subject', 'Message', 'Date', 'Time']]
                }
            });
        }

        // Append the new row
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:F`,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
                values: [[name || 'Anonymous', email, subject || 'No Subject', message, dateStr, timeStr]]
            }
        });

        console.log(`✅ Google Sheets: Entry added for ${email}`);
        return true;
    } catch (err) {
        console.error('❌ Google Sheets Error:', err.message);
        return false;
    }
}

module.exports = { appendContactRow };
