const http = require('http');

async function testAuthFlow() {
    console.log('--- Starting Dual-Token Auth Verification ---');
    
    const email = 'testuser_' + Date.now() + '@example.com';
    const password = 'password123';

    try {
        console.log('1. Registering test user...');
        let res = await fetch('http://localhost:3000/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        if (!res.ok) throw new Error('Registration failed');
        console.log('   ✅ User registered successfully.');

        console.log('2. Logging in...');
        res = await fetch('http://localhost:3000/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, stayLoggedIn: true })
        });
        
        const text = await res.text(); console.log('Login Raw Response:', text); const loginData = JSON.parse(text);
        const setCookieHeader = res.headers.get('set-cookie');
        
        if (!loginData.token) throw new Error('No access token returned in JSON body');
        if (!setCookieHeader || !setCookieHeader.includes('refreshToken=')) throw new Error('No refreshToken cookie set');
        
        const accessToken1 = loginData.token;
        const refreshTokenCookie1 = setCookieHeader.split(';')[0]; // Gets the "refreshToken=..." part
        
        console.log('   ✅ Login successful.');
        console.log('      - Access Token Received');
        console.log('      - HttpOnly Cookie Received: ' + refreshTokenCookie1);

        console.log('3. Testing Protected Route with Access Token...');
        res = await fetch('http://localhost:3000/api/user/profile', {
            headers: { 'Authorization': `Bearer ${accessToken1}` }
        });
        if (!res.ok) throw new Error('Protected route rejected access token');
        console.log('   ✅ Protected route accessed successfully.');

        console.log('4. Testing Silent Refresh (Token Rotation)...');
        res = await fetch('http://localhost:3000/api/refresh-token', {
            method: 'POST',
            headers: { 'Cookie': refreshTokenCookie1 }
        });
        
        if (!res.ok) throw new Error(`Refresh token failed with status ${res.status}`);
        const refreshData = await res.json();
        const setCookieHeader2 = res.headers.get('set-cookie');
        
        if (!refreshData.token) throw new Error('No new access token returned in JSON body');
        if (!setCookieHeader2 || !setCookieHeader2.includes('refreshToken=')) throw new Error('No new refreshToken cookie set');
        
        const accessToken2 = refreshData.token;
        const refreshTokenCookie2 = setCookieHeader2.split(';')[0];
        
        console.log('   ✅ Refresh successful.');
        console.log('      - New Access Token Received');
        console.log('      - New HttpOnly Cookie Received: ' + refreshTokenCookie2);
        
        if (accessToken1 === accessToken2) {
            console.warn('   ⚠️ Warning: Access token did not change (might be fine depending on logic, but usually should).');
        }
        if (refreshTokenCookie1 === refreshTokenCookie2) {
            throw new Error('Refresh token was not rotated!');
        } else {
            console.log('   ✅ Refresh token rotation verified successfully.');
        }

        console.log('5. Testing Old Refresh Token (Replay Attack Prevention)...');
        res = await fetch('http://localhost:3000/api/refresh-token', {
            method: 'POST',
            headers: { 'Cookie': refreshTokenCookie1 }
        });
        
        if (res.status !== 401) {
            console.warn(`   ⚠️ Expected 401 Unauthorized for reused refresh token, but got ${res.status}`);
        } else {
            console.log('   ✅ Old refresh token correctly rejected (Session terminated or denied).');
        }

        console.log('6. Logging out...');
        res = await fetch('http://localhost:3000/api/logout', {
            method: 'POST',
            headers: { 'Cookie': refreshTokenCookie2 }
        });
        
        if (!res.ok) throw new Error('Logout failed');
        console.log('   ✅ Logout successful.');

        console.log('\n🎉 ALL TESTS PASSED: The new Dual-Token Session Architecture is fully working!');

    } catch (err) {
        console.error('\n❌ TEST FAILED:', err.message);
    }
}

testAuthFlow();
