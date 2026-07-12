import { getSupportEmail } from "@/lib/env";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/branding";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export default function TermsOfService() {
  const supportEmail = getSupportEmail();

  return (
    <LegalDocumentPage
      title="Terms of Service"
      footerNote="This is a structural terms of service stub. A full legal review is recommended before external OAuth verification."
    >
      <section>
        <h2 className="text-lg font-semibold text-foreground">Acceptance of terms</h2>
        <p className="mt-2">
          By accessing or using {PRODUCT_NAME} — {PRODUCT_TAGLINE}, you agree to these Terms of Service.
          If you do not agree, do not use the platform.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Educational purpose only</h2>
        <p className="mt-2">
          {PRODUCT_NAME} provides educational market analysis, investment research tools, and paper trading for
          learning purposes. Content provided through {PRODUCT_NAME}, including AI-generated analysis, is not
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
    </LegalDocumentPage>
  );
}
