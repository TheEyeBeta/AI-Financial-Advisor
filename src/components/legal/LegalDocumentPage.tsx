import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PRODUCT_NAME } from '@/lib/branding';

interface LegalDocumentPageProps {
  title: string;
  lastUpdated?: string;
  children: ReactNode;
  footerNote?: string;
}

export function LegalDocumentPage({
  title,
  lastUpdated = 'July 2026',
  children,
  footerNote,
}: LegalDocumentPageProps) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Link to="/" className="text-sm text-primary hover:underline">
          &larr; Back to {PRODUCT_NAME}
        </Link>

        <h1 className="mt-6 text-3xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted-foreground">
          {children}
          {footerNote && <p className="text-xs italic">{footerNote}</p>}
        </div>
      </div>
    </div>
  );
}
