import { Link } from "react-router-dom";
import { getSupportEmail } from "@/lib/env";

export default function PrivacyPolicy() {
  const supportEmail = getSupportEmail();

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Link to="/" className="text-sm text-primary hover:underline">
          &larr; Back to Lens
        </Link>

        <h1 className="mt-6 text-3xl font-bold">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: July 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-lg font-semibold text-foreground">About Lens</h2>
            <p className="mt-2">
              Lens is an AI-assisted financial education, investment research and paper-trading platform.
              This policy describes how we collect and use information when you use Lens.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Information we collect</h2>
            <p className="mt-2">
              When you create an account, we collect your email address and, if you choose email registration,
              your name and password. When you sign in with Google, we receive your basic profile information
              (name and email address) from Google to identify your account.
            </p>
            <p className="mt-2">
              Google authentication is used to identify your account and retrieve your basic profile information,
              including your name and email address. Lens does not access your Gmail, Google Drive, contacts or calendar.
            </p>
            <p className="mt-2">
              During financial onboarding, we collect additional profile information such as age range, income,
              expenses, risk profile, investment horizon, and financial goals to personalise your experience.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">How we use your information</h2>
            <p className="mt-2">
              We use your information to authenticate your account, provide educational financial analysis,
              paper trading features, and personalised onboarding. We do not sell your personal information.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Contact</h2>
            <p className="mt-2">
              For privacy-related questions, contact us at{" "}
              <a href={`mailto:${supportEmail}`} className="text-primary hover:underline">
                {supportEmail}
              </a>
              .
            </p>
          </section>

          <p className="text-xs italic">
            This is a structural privacy policy stub. A full legal review is recommended before external OAuth verification.
          </p>
        </div>
      </div>
    </div>
  );
}
