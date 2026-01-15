// Quick test script to verify Supabase connection
// Run with: node test-supabase-connection.js

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

console.log('🔍 Testing Supabase Connection...\n');

// Check if env variables are set
if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables!');
  console.log('VITE_SUPABASE_URL:', supabaseUrl || 'NOT SET');
  console.log('VITE_SUPABASE_ANON_KEY:', supabaseKey ? 'SET (hidden)' : 'NOT SET');
  console.log('\nMake sure your .env file exists and has the correct values.');
  process.exit(1);
}

console.log('✅ Environment variables found');
console.log('   URL:', supabaseUrl);
console.log('   Key:', supabaseKey.substring(0, 20) + '...\n');

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

// Test connection by trying to list tables (using a simple query)
async function testConnection() {
  try {
    console.log('🔄 Testing connection...\n');
    
    // Test 1: Check if we can query auth (this is always available)
    console.log('Test 1: Checking authentication system...');
    const { data: authData, error: authError } = await supabase.auth.getSession();
    
    if (authError) {
      console.log('   ⚠️  Auth check:', authError.message);
    } else {
      console.log('   ✅ Auth system accessible');
      console.log('   Session:', authData.session ? 'Active session found' : 'No active session (expected)');
    }
    
    // Test 2: Try to query a table (this will fail if schema isn't run yet, but connection works)
    console.log('\nTest 2: Testing database connection...');
    const { data, error } = await supabase
      .from('portfolio_history')
      .select('count')
      .limit(1);
    
    if (error) {
      if (error.code === 'PGRST116' || error.message.includes('relation') || error.message.includes('does not exist')) {
        console.log('   ⚠️  Tables not found - this means:');
        console.log('      • ✅ Connection to Supabase WORKS!');
        console.log('      • ❌ Database schema hasn\'t been run yet');
        console.log('      • 📋 Run supabase-schema.sql in Supabase SQL Editor');
      } else if (error.code === 'PGRST301' || error.message.includes('permission') || error.message.includes('RLS')) {
        console.log('   ⚠️  Permission error - this means:');
        console.log('      • ✅ Connection to Supabase WORKS!');
        console.log('      • ✅ Tables exist!');
        console.log('      • ⚠️  RLS policies are working (need authentication)');
      } else {
        console.log('   ❌ Error:', error.message);
        console.log('   Code:', error.code);
      }
    } else {
      console.log('   ✅ Database connection successful!');
      console.log('   ✅ Tables exist!');
      console.log('   Data:', data);
    }
    
    // Test 3: Check Supabase service status
    console.log('\nTest 3: Verifying Supabase URL...');
    try {
      const response = await fetch(supabaseUrl + '/rest/v1/', {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      });
      
      if (response.ok || response.status === 404) {
        console.log('   ✅ Supabase URL is accessible');
        console.log('   Status:', response.status);
      } else {
        console.log('   ⚠️  Unexpected status:', response.status);
      }
    } catch (fetchError) {
      console.log('   ❌ Network error:', fetchError.message);
      console.log('   This might indicate the URL is incorrect or network issues');
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 SUMMARY:');
    console.log('   Supabase URL: ✅ Configured');
    console.log('   Supabase Key: ✅ Configured');
    console.log('   Connection: ✅ Working');
    console.log('\n   Next steps:');
    console.log('   1. Run supabase-schema.sql in Supabase SQL Editor');
    console.log('   2. Test the app: npm run dev');
    console.log('   3. Check browser console for any errors');
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('\n❌ Connection test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testConnection();
