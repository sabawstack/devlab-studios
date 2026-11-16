/**
 * "by DevLab Studios" (BRAND-04): a quiet endorsement with the logo mark, for
 * footers only, never over courts or scores. Node does not appear in the app.
 */
export default function Endorsement({ className = '' }) {
  return (
    <a href="/" className={`inline-flex min-h-11 items-center justify-center gap-2 text-xs text-mist hover:text-white ${className}`} data-testid="endorsement">
      <img src="/branding/logo-only.svg" alt="" width="16" height="16" className="h-4 w-4" />
      <span>DevLab Pickleball, by DevLab Studios</span>
    </a>
  )
}
