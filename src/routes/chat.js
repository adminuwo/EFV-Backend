const express = require('express');
const router = express.Router();

// Chat endpoint
router.post('/message', async (req, res) => {
    try {
        const { message, history = [] } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        let text = '';
        let isDemoResponse = false;

        try {
            // Require the Vertex AI model
            const { generativeModel } = require('../config/vertex.js');

            // Build chat history for context
            const chat = generativeModel.startChat({
                history: history.map(msg => ({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.content }]
                }))
            });

            // Send message and get response
            const result = await chat.sendMessage(message);
            const response = result.response;
            text = response.candidates[0].content.parts[0].text;

        } catch (aiError) {
            console.warn('⚠️ Vertex AI failed or not configured. Switching to Demo Mode.', aiError.message);
            isDemoResponse = true;

            // Dictionary of keywords to detect Hindi
            const hindiKeywords = ['kya', 'kaise', 'hai', 'btao', 'kru', 'karu', 'sakin', 'sakte', 'book', 'kitab', 'pustak', 'hindi', 'me', 'samjhaye', 'samjhao'];
            const isHindi = hindiKeywords.some(kw => message.toLowerCase().includes(kw));

            // Knowledge Base for Demo Mode
            const knowledgeBase = {
                // Pages
                home: {
                    keywords: ['home', 'index', 'main', 'shuruat', 'start'],
                    en: "The Home page represents the beginning of your alignment journey. It features the 'Measure Your Alignment' tool and introduces the core philosophy of EFV™.",
                    hi: "Home page aapki alignment yatra ki shuruat hai. Yahan 'Measure Your Alignment' tool hai aur EFV™ ka mukhya darsan (philosophy) bataya gaya hai."
                },
                about: {
                    keywords: ['about', 'who', 'uwo', 'founder', 'author', 'writer', 'gurumukh', 'sir', 'creator', 'koun', 'baare', 'lekhak'],
                    en: "EFV™ was created and written by **Gurumukh P. Ahuja**. He is the founder of UWO™ and the visionary behind the Alignment Intelligence System, designed to elevate human Energy, Frequency, and Vibration.",
                    hi: "EFV™ के लेखक और संस्थापक **Mr. Gurumukh P. Ahuja** हैं। उन्होंने UWO™ के माध्यम से इस सिस्टम को बनाया है ताकि मनुष्य अपनी Energy, Frequency, और Vibration को बढ़ा सकें।"
                },
                gallery: {
                    keywords: ['gallery', 'photo', 'image', 'picture', 'tasveer', 'photo'],
                    en: "The Gallery showcases visual representations of alignment and flow state. It is a curated collection designed to inspire visual harmony.",
                    hi: "Gallery mein alignment aur flow state ki visual tasveerein hain. Ye ek khaas collection hai jo aapko visual harmony ka anubhav karata hai."
                },
                marketplace: {
                    keywords: ['market', 'shop', 'store', 'buy', 'purchase', 'kharid', 'dukan'],
                    en: "The Marketplace is where you can purchase EFV™ resources. We offer Audiobooks, E-books, and physical formats of our canon Volumes.",
                    hi: "Marketplace wo jagah hai jahan aap EFV™ sansadhan kharid sakte hain. Hum Audiobooks, E-books, aur physical books (Volumes) offer karte hain."
                },
                feedback: {
                    keywords: ['feed', 'review', 'rating', 'sujhav', 'ray'],
                    en: "The Feedback section allows you to share your experience with EFV™. Your insights help us refine the Alignment Intelligence System.",
                    hi: "Feedback section mein aap EFV™ ke sath apna anubhav share kar sakte hain. Aapke sujhav hamein behtar banne mein madad karte hain."
                },
                contact: {
                    keywords: ['contact', 'email', 'support', 'help', 'sampark', 'madad'],
                    en: "The Contact page provides ways to reach the EFV™ team for support, inquiries, or guidance.",
                    hi: "Contact page par aap EFV™ team se sampark kar sakte hain, chahe wo support ke liye ho ya kisi sawal ke liye."
                },
                // Books (Volumes 1-9)
                vol1: {
                    keywords: ['vol 1', 'volume 1', 'origin', 'one', 'pehla', 'ek'],
                    en: "EFV™ Volume 1: 'ORIGIN CODE'. A journey into the starting point of everything — where consciousness, energy, and existence begin. Lays the foundation for understanding how reality is formed.",
                    hi: "EFV™ Volume 1: 'ORIGIN CODE'. Ye yatra hai sabhi cheezon ke shuruati bindu ki — jahan chetna, energy, aur astitva shuru hote hain."
                },
                vol2: {
                    keywords: ['vol 2', 'volume 2', 'mindos', 'two', 'dusra', 'do'],
                    en: "EFV™ Volume 2: 'MINDOS™'. An exploration of how thoughts and emotions shape our inner world. It breaks down the architecture of the human mind.",
                    hi: "EFV™ Volume 2: 'MINDOS™'. Ismein bataya gaya hai ki kaise hamare vichar aur bhavnayein hamari andaruni duniya ko roop dete hain."
                },
                vol3: {
                    keywords: ['vol 3', 'volume 3', 'universal', 'activation', 'teen'],
                    en: "EFV™ Volume 3: 'UNIVERSAL ACTIVATION'. A guide to awakening the untapped potential within you and activating deeper frequencies.",
                    hi: "EFV™ Volume 3: 'UNIVERSAL ACTIVATION'. Ye aapke andar ki ansuljhi sambhavnaon ko jagane aur gehri frequencies ko activate karne ka guide hai."
                },
                vol4: {
                    keywords: ['vol 4', 'volume 4', 'resonance', 'bridge', 'char'],
                    en: "EFV™ Volume 4: 'RESONANCE BRIDGE'. Bridges the gap between human awareness and universal intelligence through alignment and flow.",
                    hi: "EFV™ Volume 4: 'RESONANCE BRIDGE'. Ye manviye jagrukta aur brahmandiya buddhimatta ke beech ke antar ko alignment ke zariye bharta hai."
                },
                vol5: {
                    keywords: ['vol 5', 'volume 5', 'human os', 'paanch'],
                    en: "EFV™ Volume 5: 'HUMAN OS™'. A fresh look at the human operating system and its connection with the next era of AI.",
                    hi: "EFV™ Volume 5: 'HUMAN OS™'. Manviye operating system aur AI ke agle yug ke beech ke sambandh ka ek naya nazariya."
                },
                vol6: {
                    keywords: ['vol 6', 'volume 6', 'emotionos', 'chhe'],
                    en: "EFV™ Volume 6: 'EMOTIONOS™'. Explains emotional intelligence as a powerful stabilizing force for harmony.",
                    hi: "EFV™ Volume 6: 'EMOTIONOS™'. Ismein emotional intelligence ko ek shaktishali stabilizing force ke roop mein samjhaya gaya hai."
                },
                vol7: {
                    keywords: ['vol 7', 'volume 7', 'memoryos', 'saat'],
                    en: "EFV™ Volume 7: 'MEMORYOS™'. Explores memory as the thread that holds identity together across time.",
                    hi: "EFV™ Volume 7: 'MEMORYOS™'. Samay ke sath hamari pehchan ko banaye rakhne wale 'memory' ke dhage ki khoj."
                },
                vol8: {
                    keywords: ['vol 8', 'volume 8', 'agentos', 'aath'],
                    en: "EFV™ Volume 8: 'AGENTOS™'. Unpacks the rise of autonomous intelligence and intelligent agents.",
                    hi: "EFV™ Volume 8: 'AGENTOS™'. Ismein autonomous intelligence aur intelligent agents ke uday ko vistar se samjhaya gaya hai."
                },
                vol9: {
                    keywords: ['vol 9', 'volume 9', 'governanceos', 'nau'],
                    en: "EFV™ Volume 9: 'GOVERNANCEOS™'. Focuses on ethics, alignment, and responsibility in an AI-powered civilization.",
                    hi: "EFV™ Volume 9: 'GOVERNANCEOS™'. AI-powered sabhyata mein naitikta, alignment aur zimmedari par kendrit."
                },
                // Generic fallbacks
                greeting: {
                    keywords: ['hello', 'hi', 'hey', 'namaste', 'pranam'],
                    en: "Greetings. I am EFV™ Intelligence. How may I assist you with your alignment today?",
                    hi: "Namaste. Main EFV™ Intelligence hoon. Aaj main aapki alignment mein kaise madad kar sakta hoon?"
                },
                efv: {
                    keywords: ['efv', 'what is', 'kya hai'],
                    en: "EFV™ stands for Energy, Frequency, and Vibration. It is a system designed to measure and elevate your inner alignment.",
                    hi: "EFV™ ka matlab hai Energy, Frequency, aur Vibration. Ye ek system hai jo aapki atma ki alignment ko napne aur badhane ke liye banaya gaya hai."
                }
            };

            // Find matching response
            const lowerMsg = message.toLowerCase();
            let responseKey = null;

            // Check specific volumes/books first
            for (let i = 1; i <= 9; i++) {
                if (lowerMsg.includes(`vol ${i}`) || lowerMsg.includes(`volume ${i}`) || lowerMsg.includes(`pustak ${i}`) || lowerMsg.includes(`kitab ${i}`)) {
                    // Since we only detailed Vol 1 & 2 explicitly above, we can generate generic ones for 3-9 or add them to KB.
                    // For demo purposes, we'll map all specific generic volume queries if not found to a generic structure or detailed ones if added.
                    if (knowledgeBase[`vol${i}`]) {
                        responseKey = `vol${i}`;
                    } else {
                        // Fallback for Vol 3-9
                        text = isHindi
                            ? `EFV™ Volume ${i} जल्द ही उपलब्ध होगा। कृपया Marketplace चेक करें। इसके लेखक **Mr. Gurumukh P. Ahuja** हैं।`
                            : `EFV™ Volume ${i} is coming soon. Please check the Marketplace for updates. It is written by **Mr. Gurumukh P. Ahuja**.`;
                        responseKey = 'found'; // Mark as found to skip loop
                    }
                    break;
                }
            }

            // Keyword for author specifically
            if (!responseKey && (lowerMsg.includes('writer') || lowerMsg.includes('author') || lowerMsg.includes('gurumukh') || lowerMsg.includes('sir') || lowerMsg.includes('lekhak'))) {
                responseKey = 'about';
            }

            if (!responseKey || responseKey !== 'found') {
                // Search KB for other keywords
                for (const [key, data] of Object.entries(knowledgeBase)) {
                    if (data.keywords.some(k => lowerMsg.includes(k))) {
                        responseKey = key;
                        break;
                    }
                }
            }

            if (responseKey && responseKey !== 'found') {
                text = isHindi ? knowledgeBase[responseKey].hi : knowledgeBase[responseKey].en;
            } else if (!text) {
                // Default fallback
                text = isHindi
                    ? "Main EFV™ Intelligence hoon (Demo Mode). Main abhi seekh raha hoon. Kripya 'Home', 'Gallery', 'Volume 1' ya 'Alignment' ke baare mein puchein."
                    : "I am EFV™ Intelligence (Demo Mode). I am currently calibrating. Please ask about 'Home', 'Gallery', 'Volume 1', or 'Alignment'.";
            }
        }

        res.json({
            response: text,
            isDemo: isDemoResponse,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Chat API Error:', error);
        res.status(500).json({
            error: 'Failed to process message',
            details: error.message
        });
    }
});

module.exports = router;
