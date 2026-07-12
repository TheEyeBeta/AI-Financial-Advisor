import { isGoogleAuthEnabled } from '@/lib/env';
import { GoogleAuthButton } from '@/components/auth/GoogleAuthButton';
import { AuthDivider } from '@/components/auth/AuthDivider';

interface GoogleOAuthSectionProps {
  returnTo: string;
  disabled?: boolean;
  onRedirectingChange?: (redirecting: boolean) => void;
}

export function GoogleOAuthSection({
  returnTo,
  disabled = false,
  onRedirectingChange,
}: GoogleOAuthSectionProps) {
  if (!isGoogleAuthEnabled()) {
    return null;
  }

  return (
    <>
      <GoogleAuthButton
        returnTo={returnTo}
        disabled={disabled}
        onRedirectingChange={onRedirectingChange}
      />
      <AuthDivider />
    </>
  );
}
