// Cloudflare Worker - Handles API requests, Upstash Redis, and Telegram notifications

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // Route: Verify form access password
            if (path === '/api/verify' && request.method === 'POST') {
                const { password } = await request.json();
                const isValid = password === env.FORM_PASSWORD;

                return new Response(JSON.stringify({ success: isValid }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            // Route: Submit registration
            if (path === '/api/register' && request.method === 'POST') {
                const data = await request.json();
                return await handleRegistration(data, env, corsHeaders);
            }

            // Route: Verify admin PIN
            if (path === '/api/admin/verify' && request.method === 'POST') {
                const { pin } = await request.json();
                const isValid = pin === env.ADMIN_PIN;

                return new Response(JSON.stringify({ success: isValid }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            // Route: Get all registrations (admin)
            if (path === '/api/admin/registrations' && request.method === 'POST') {
                const { pin } = await request.json();
                
                if (pin !== env.ADMIN_PIN) {
                    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
                        status: 401,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    });
                }

                const registrations = await getAllRegistrations(env);
                return new Response(JSON.stringify({ success: true, data: registrations }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }

            // 404 for unknown routes
            return new Response('Not Found', { status: 404, headers: corsHeaders });

        } catch (error) {
            return new Response(JSON.stringify({ success: false, error: error.message }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
    }
};

// Handle registration submission
async function handleRegistration(data, env, corsHeaders) {
    const { fullName, email, officerId, department, phone, notes, submittedAt } = data;

    // Validate required fields
    if (!fullName || !email || !officerId || !department) {
        return new Response(JSON.stringify({ 
            success: false, 
            error: 'Full name, email, officer ID, and department are required.' 
        }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Check for duplicate email or officer ID
    const existingRegistrations = await getAllRegistrations(env);
    const isDuplicate = existingRegistrations.some(reg => 
        reg.email.toLowerCase() === email.toLowerCase() || 
        reg.officerId.toLowerCase() === officerId.toLowerCase()
    );

    if (isDuplicate) {
        return new Response(JSON.stringify({ 
            success: false, 
            duplicate: true,
            error: 'This email or officer ID is already registered.' 
        }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Generate unique ID
    const id = `reg_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Store in Upstash Redis
    const registration = {
        id,
        fullName,
        email,
        officerId,
        department,
        phone: phone || '',
        notes: notes || '',
        submittedAt: submittedAt || new Date().toISOString()
    };

    await storeRegistration(env, id, registration);

    // Send Telegram notification
    await sendTelegramNotification(env, registration);

    return new Response(JSON.stringify({ success: true, id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

// Store registration in Upstash Redis
async function storeRegistration(env, id, data) {
    const url = `${env.UPSTASH_REDIS_URL}/set/${id}`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.UPSTASH_REDIS_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error('Failed to store registration');
    }

    // Add to index (list of all registration IDs)
    await fetch(`${env.UPSTASH_REDIS_URL}/lpush/registration_ids`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.UPSTASH_REDIS_TOKEN}`,
        },
        body: JSON.stringify(id),
    });
}

// Get all registrations from Upstash Redis
async function getAllRegistrations(env) {
    try {
        // Get list of all IDs
        const idsResponse = await fetch(`${env.UPSTASH_REDIS_URL}/lrange/registration_ids/0/-1`, {
            headers: {
                'Authorization': `Bearer ${env.UPSTASH_REDIS_TOKEN}`,
            },
        });

        const idsResult = await idsResponse.json();
        const ids = idsResult.result || [];

        if (ids.length === 0) return [];

        // Fetch each registration
        const registrations = [];
        for (const id of ids) {
            const regResponse = await fetch(`${env.UPSTASH_REDIS_URL}/get/${id}`, {
                headers: {
                    'Authorization': `Bearer ${env.UPSTASH_REDIS_TOKEN}`,
                },
            });
            const regResult = await regResponse.json();
            const regData = JSON.parse(regResult.result);
            if (regData) registrations.push(regData);
        }

        // Sort by date, newest first
        return registrations.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    } catch (error) {
        console.error('Error fetching registrations:', error);
        return [];
    }
}

// Send Telegram notification
async function sendTelegramNotification(env, registration) {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        console.log('Telegram not configured');
        return;
    }

    const message = `
🔔 *New Officer Registration*

👤 *Name:* ${registration.fullName}
📧 *Email:* ${registration.email}
🆔 *Officer ID:* ${registration.officerId}
🏢 *Department:* ${registration.department}
📞 *Phone:* ${registration.phone || 'N/A'}
📝 *Notes:* ${registration.notes || 'N/A'}
📅 *Submitted:* ${new Date(registration.submittedAt).toLocaleString()}
    `.trim();

    const telegramUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

    try {
        await fetch(telegramUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: env.TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown',
            }),
        });
    } catch (error) {
        console.error('Telegram notification failed:', error);
    }
}
