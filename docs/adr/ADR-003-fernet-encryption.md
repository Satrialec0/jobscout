# ADR-003: Fernet Symmetric Encryption for Third-Party Session Credentials

**Status:** Accepted
**Date:** 2026-04-12

## Context

The hiring.cafe session cookie is a third-party credential that grants access to the user's hiring.cafe account. It must be stored in PostgreSQL so the backend scraper can use it. Storing it in plaintext means a database compromise exposes a working session credential immediately.

## Decision

Encrypt the cookie value with Fernet symmetric encryption before writing to the database. The encryption key is stored in `backend/.env` as `FERNET_KEY` and never written to the database.

```python
from cryptography.fernet import Fernet
fernet = Fernet(settings.fernet_key)

# Write
encrypted = fernet.encrypt(cookie_value.encode())

# Read
decrypted = fernet.decrypt(encrypted).decode()
```

## Alternatives Considered

**Plaintext storage:** Simple. For a personal tool behind a Cloudflare tunnel with a private database, the realistic attack surface is small. Rejected because the habit of storing credentials in plaintext is poor practice regardless of perceived risk, and Fernet adds only 5 lines of code.

**Asymmetric encryption (RSA/ECDSA):** Appropriate when the entity that encrypts is different from the entity that decrypts (e.g. the extension encrypts, only the server can decrypt). In this case, the backend both stores and retrieves the credential, so symmetric encryption is the correct primitive.

**AWS KMS / Vault:** Production-grade key management services. Appropriate for a multi-tenant SaaS handling many users' credentials. Overkill for a personal tool; adds an external dependency and cost.

**PostgreSQL column encryption (pgcrypto):** Encrypts at the database layer. Requires the encryption key in the DB connection, which complicates key rotation and doesn't protect against a compromised DB superuser session.

## Consequences

**Positive:**
- A PostgreSQL dump or direct DB access does not expose usable credentials without the `FERNET_KEY`.
- Fernet provides authenticated encryption — it detects tampering. A corrupted or modified ciphertext raises an exception rather than silently decrypting to garbage.
- Key rotation is possible: re-encrypt all stored values with a new key without any application downtime.
- `cryptography` is a standard Python package with no unusual dependencies.

**Negative:**
- If `FERNET_KEY` is lost, all stored credentials are permanently unrecoverable. Users would need to re-sync by visiting hiring.cafe. This is acceptable — it's a session token, not a password.
- The key in `.env` must be protected. If an attacker has both the database and the `.env` file, encryption provides no protection. This is a known limitation of envelope encryption without a dedicated key management service.

**Key generation:**
```python
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())  # Run once, store in .env
```
