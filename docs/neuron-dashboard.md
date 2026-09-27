# FirstNeuron dashboard

Public dashboard: https://143.198.121.2/

Enabled at the user's request on 2026-09-27. Uses the existing dashboard
username/password held in the protected host environment. No credentials are
stored in this document. HTTPS login uses HttpOnly, Secure, SameSite=Strict
session cookies, exact configured-origin checks and existing login rate limits.

The dashboard displays registered peers, recent peer activity, encrypted envelope
and recipient-receipt counts, discovery capability, and signed signaling exchange
counts. It provides status and logout; it does not yet provide FirstNeuron's own
chat/call UI or editable network administration.

NEURON_DASHBOARD_ORIGIN=https://143.198.121.2 is supplied by the service's
dashboard-origin.conf drop-in. Login now uses the public HTTPS URL. The backend
listeners remain bound to loopback; nginx exposes the dashboard's exact route
allowlist and the two signed peer endpoints. Public /health stays unavailable.

Verified local private/HTTPS-mode authentication tests and live HTTPS login,
unauthenticated status rejection, cross-origin rejection, secure cookies and logout.
Existing credentials were read and submitted only on the host during verification.
Deployment backups: /opt/axonic-neuron/dist-before-public-dashboard-20260927 and
/etc/nginx/neuron-https-before-dashboard.backup.
