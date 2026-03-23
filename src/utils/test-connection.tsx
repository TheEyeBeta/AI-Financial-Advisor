// React component to test Supabase connection
// You can import and use this in your app to verify connection

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { getErrorMessage } from '@/lib/error';

interface ConnectionStatus {
  status: 'checking' | 'connected' | 'error' | 'tables-missing' | 'auth-required';
  message: string;
  details?: string;
}

export function SupabaseConnectionTest() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    status: 'checking',
    message: 'Testing connection...'
  });

  useEffect(() => {
    testConnection();
  }, []);

  async function testConnection() {
    try {
      setConnectionStatus({ status: 'checking', message: 'Testing Supabase connection...' });

      // Test 1: Check environment variables
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        setConnectionStatus({
          status: 'error',
          message: 'Missing environment variables',
          details: 'VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set in .env file'
        });
        return;
      }

      // Test 2: Check auth system
      const { error: authError } = await supabase.auth.getSession();
      
      if (authError) {
        setConnectionStatus({
          status: 'error',
          message: 'Auth system error',
          details: authError.message
        });
        return;
      }

      // Test 3: Try to query a table
      const { error } = await supabase
        .schema('trading')
        .from('portfolio_history')
        .select('count')
        .limit(1);

      if (error) {
        // Check error type
        if (error.code === 'PGRST116' || error.message.includes('relation') || error.message.includes('does not exist')) {
          setConnectionStatus({
            status: 'tables-missing',
            message: 'Connected to Supabase, but tables not found',
            details: 'Run sql/schema.sql, then sql/fix_rls_policies_schema.sql and sql/verify_runtime_schema_readiness.sql in the Supabase SQL Editor.'
          });
        } else if (error.code === 'PGRST301' || error.message.includes('permission') || error.message.includes('RLS')) {
          setConnectionStatus({
            status: 'auth-required',
            message: 'Connected! Tables exist, but authentication required',
            details: 'RLS policies are working correctly. You need to sign in to access data.'
          });
        } else {
          setConnectionStatus({
            status: 'error',
            message: 'Database query error',
            details: error.message
          });
        }
        return;
      }

      // Success!
      setConnectionStatus({
        status: 'connected',
        message: 'Successfully connected to Supabase!',
        details: 'All systems operational'
      });

    } catch (error: unknown) {
      setConnectionStatus({
        status: 'error',
        message: 'Connection test failed',
        details: getErrorMessage(error) || 'Unknown error'
      });
    }
  }

  const getStatusIcon = () => {
    switch (connectionStatus.status) {
      case 'checking':
        return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
      case 'connected':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'auth-required':
        return <AlertCircle className="h-5 w-5 text-yellow-500" />;
      case 'tables-missing':
        return <AlertCircle className="h-5 w-5 text-orange-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-red-500" />;
    }
  };

  const getStatusBadge = () => {
    switch (connectionStatus.status) {
      case 'connected':
        return <Badge className="bg-green-500">Connected</Badge>;
      case 'auth-required':
        return <Badge className="bg-yellow-500">Auth Required</Badge>;
      case 'tables-missing':
        return <Badge className="bg-orange-500">Tables Missing</Badge>;
      case 'error':
        return <Badge className="bg-red-500">Error</Badge>;
      default:
        return <Badge>Checking...</Badge>;
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            {getStatusIcon()}
            Supabase Connection Status
          </CardTitle>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="font-medium">{connectionStatus.message}</p>
          {connectionStatus.details && (
            <p className="text-sm text-muted-foreground mt-2">{connectionStatus.details}</p>
          )}
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <div>
            <strong>Supabase URL:</strong>{' '}
            {import.meta.env.VITE_SUPABASE_URL ? (
              <span className="text-green-600">✓ Configured</span>
            ) : (
              <span className="text-red-600">✗ Missing</span>
            )}
          </div>
          <div>
            <strong>Supabase Key:</strong>{' '}
            {import.meta.env.VITE_SUPABASE_ANON_KEY ? (
              <span className="text-green-600">✓ Configured</span>
            ) : (
              <span className="text-red-600">✗ Missing</span>
            )}
          </div>
        </div>

        <button
          onClick={testConnection}
          className="text-sm text-primary hover:underline"
        >
          Retest Connection
        </button>
      </CardContent>
    </Card>
  );
}
