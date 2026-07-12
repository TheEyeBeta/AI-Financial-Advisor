import { Link } from "react-router-dom";
import { getSupportEmail } from "@/lib/env";

export default function TermsOfService() {
  const supportEmail = getSupportEmail();

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Link to="/" className="text-sm text-primary hover:underline">
          &larr; Back to Lens
        </Link>

        <h1 className="mt-6 text-3xl font-bold">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: July 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-lg font-semibold text-foreground">Acceptance of terms</h2>
            <p className="mt-2">
              By accessing or using Lens — AI Financial Advisor, you agree to these Terms of Service.
              If you do not agree, do not use the platform.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Educational purpose only</h2>
            <p className="mt-2">
              Lens provides educational market analysis, investment research tools, and paper trading for
              learning purposes. Content provided through Lens, including AI-generated analysis, is not
              personalised investment advice. You are solely responsible for your financial decisions.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Account responsibilities</h2>
            <p className="mt-2">
              You are responsible for maintaining the confidentiality of your account credentials and for
              all activity under your account. You must provide accurate information during registration
              and onboarding.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Contact</h2>
            <p className="mt-2">
              For questions about these terms, contact us at{" "}
              <a href={`mailto:${supportEmail}`} className="text-primary hover:underline">
                {supportEmail}
              </a>
              .
            </p>
          </section>

          <p className="text-xs italic">
            This is a structural terms of service stub. A full legal review is recommended before external OAuth verification.
          </p>
        </div>
      </div>
    </div>
  );
}
