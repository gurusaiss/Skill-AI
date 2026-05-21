# Security Guidelines for SkillForge AI

This document outlines security best practices, configurations, and guidelines for the SkillForge AI authentication system.

## Table of Contents

- [Security Overview](#security-overview)
- [Authentication Security](#authentication-security)
- [Environment Configuration](#environment-configuration)
- [Production Security Checklist](#production-security-checklist)
- [Security Best Practices](#security-best-practices)
- [Incident Response](#incident-response)
- [Security Testing](#security-testing)
- [Reporting Security Issues](#reporting-security-issues)

---

## Security Overview

SkillForge AI implements a comprehensive role-based authentication system with the following security features:

- **Password Security**: bcrypt hashing with 10+ salt rounds
- **Session Management**: JWT tokens with 7-day expiration
- **Email Verification**: OTP-based email verification
- **Rate Limiting**: Protection against brute force attacks
- **CORS Protection**: Restricted cross-origin access
- **Role-Based Access Control**: Granular permissions based on user roles
- **Audit Logging**: Comprehensive logging of authentication events

---

## Authentication Security

### Password Security

#### Password Hashing

- **Algorithm**: bcrypt
- **Salt Rounds**: 10 (configurable in `server/services/AuthService.js`)
- **Verification**: Constant-time comparison via `bcrypt.compare()`

**Configuration:**

```javascript
// server/services/AuthService.js
this.saltRounds = 10; // Minimum recommended: 10
```

**Security Requirements:**

✅ Passwords are NEVER stored in plain text  
✅ bcrypt salt rounds are set to 10 or higher  
✅ Password hashing is performed server-side only  
✅ Hashed passwords are stored in `server/data/users.json`

#### Password Strength Requirements

All passwords must meet the following criteria:

- Minimum 8 characters
- At least 1 uppercase letter (A-Z)
- At least 1 lowercase letter (a-z)
- At least 1 number (0-9)

**Validation:**

```javascript
// Implemented in server/services/AuthService.js
validatePasswordStrength(password) {
  // Returns { valid: boolean, errors: string[] }
}
```

### JWT Token Security

#### Token Configuration

- **Algorithm**: HS256 (HMAC with SHA-256)
- **Secret Key**: 256-bit (32 bytes = 64 hex characters)
- **Expiration**: 7 days (configurable)
- **Storage**: Browser localStorage (client-side)

**Security Requirements:**

✅ JWT secret is at least 256 bits (64 hex characters)  
✅ JWT secret is stored in environment variables (never in code)  
✅ JWT secret is different between development and production  
✅ Tokens are signed and verified on every request  
✅ Expired tokens are rejected automatically

#### Generating a Secure JWT Secret

**Method 1: Node.js**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Method 2: OpenSSL**

```bash
openssl rand -hex 32
```

**Method 3: Python**

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

**Example Output:**

```
a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2
```

⚠️ **NEVER use the example above in production!**

#### Token Rotation

- **Recommendation**: Rotate JWT secrets every 90 days in production
- **Impact**: Rotating the secret invalidates all existing user sessions
- **Process**:
  1. Generate a new 256-bit secret
  2. Update `JWT_SECRET` in production environment
  3. Restart the server
  4. Notify users they need to log in again

### Rate Limiting

Rate limiting is implemented to prevent brute force attacks and abuse.

#### Login Endpoint

- **Limit**: 5 attempts per 15 minutes per IP address
- **Endpoint**: `POST /api/auth/login`
- **Response**: HTTP 429 (Too Many Requests)

#### OTP Endpoints

- **Limit**: 3 requests per hour per user
- **Endpoints**:
  - `POST /api/auth/verify-otp`
  - `POST /api/auth/resend-otp`
- **Response**: HTTP 429 (Too Many Requests)

#### Password Reset Endpoint

- **Limit**: 3 requests per hour per email
- **Endpoint**: `POST /api/auth/forgot-password`
- **Response**: HTTP 429 (Too Many Requests)

**Configuration:**

```javascript
// server/middleware/auth.js
export const rateLimitLogin = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  // ...
});
```

### CORS Configuration

Cross-Origin Resource Sharing (CORS) is configured to restrict API access to authorized origins only.

**Allowed Origins:**

- `http://localhost:5173` (Vite dev server)
- `http://localhost:5174` (Vite alternate port)
- `process.env.FRONTEND_URL` (configured in .env)
- `process.env.VERCEL_URL` (automatically set by Vercel)

**Configuration:**

```javascript
// server/index.js
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 2 ? allowedOrigins : "*",
    credentials: true,
  }),
);
```

⚠️ **Production Requirement**: Ensure `FRONTEND_URL` is set to your actual production domain. Never use `'*'` in production.

---

## Environment Configuration

### Required Environment Variables

All sensitive configuration must be stored in environment variables, never in code.

#### Critical Security Variables

| Variable               | Description            | Security Level | Example               |
| ---------------------- | ---------------------- | -------------- | --------------------- |
| `JWT_SECRET`           | JWT signing secret     | **CRITICAL**   | 64 hex characters     |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret    | **HIGH**       | From Google Console   |
| `SMTP_PASSWORD`        | Email service password | **HIGH**       | SMTP credentials      |
| `GEMINI_API_KEY`       | Gemini API key         | **MEDIUM**     | From Google AI Studio |
| `GROQ_API_KEY`         | Groq API key           | **MEDIUM**     | From Groq Console     |

#### Environment Variable Security Rules

✅ **DO:**

- Store all secrets in environment variables
- Use different secrets for development and production
- Use a secret management system in production (AWS Secrets Manager, Azure Key Vault, etc.)
- Rotate secrets regularly (every 90 days recommended)
- Restrict access to production environment variables
- Use `.env.example` as a template (with placeholder values)

❌ **DON'T:**

- Commit `.env` files to version control
- Share secrets via email, Slack, or other insecure channels
- Use the same secrets across environments
- Hardcode secrets in source code
- Log secrets in application logs
- Use weak or predictable secrets

### .env File Security

**File Permissions:**

```bash
# Restrict .env file to owner read/write only
chmod 600 .env
```

**Git Configuration:**

Ensure `.env` is in `.gitignore`:

```gitignore
# Environment variables
.env
.env.local
.env.production
```

**Verification:**

```bash
# Check if .env is tracked by git (should return nothing)
git ls-files .env
```

---

## Production Security Checklist

Before deploying to production, verify all security requirements are met:

### Environment Configuration

- [ ] `NODE_ENV` is set to `production`
- [ ] `JWT_SECRET` is a unique 256-bit random string (different from development)
- [ ] All API keys are production keys (not development/test keys)
- [ ] SMTP credentials are for a production email service
- [ ] Google OAuth credentials are configured with production redirect URIs
- [ ] `FRONTEND_URL` points to your production domain (HTTPS)
- [ ] All secrets are stored in a secure secret management system
- [ ] `.env` file is NOT committed to version control

### Server Configuration

- [ ] HTTPS is enabled (required for secure authentication)
- [ ] SSL/TLS certificates are valid and up-to-date
- [ ] HTTP is redirected to HTTPS
- [ ] HSTS (HTTP Strict Transport Security) header is set
- [ ] Security headers are configured (CSP, X-Frame-Options, etc.)

### Authentication Configuration

- [ ] bcrypt salt rounds are set to 10 or higher
- [ ] JWT secret is at least 256 bits
- [ ] JWT expiration is appropriate for your use case (7 days recommended)
- [ ] Rate limiting is enabled on all authentication endpoints
- [ ] CORS is restricted to your actual domains (not `'*'`)
- [ ] Password strength requirements are enforced

### Monitoring & Logging

- [ ] Audit logging is enabled for all authentication events
- [ ] Failed login attempts are logged
- [ ] Sensitive data is NOT logged (passwords, tokens, secrets)
- [ ] Log retention policy is defined
- [ ] Monitoring alerts are configured for suspicious activity

### Access Control

- [ ] Role-based access control is enforced on all protected routes
- [ ] Admin accounts are limited and monitored
- [ ] Default credentials are changed
- [ ] Unused accounts are disabled

### Data Protection

- [ ] User data is stored securely
- [ ] Backups are encrypted
- [ ] Data retention policy is defined
- [ ] GDPR/privacy compliance is verified (if applicable)

---

## Security Best Practices

### Development

1. **Never commit secrets to version control**
   - Use `.env` files for local development
   - Use `.env.example` as a template with placeholder values
   - Add `.env` to `.gitignore`

2. **Use different secrets for each environment**
   - Development secrets should be different from production
   - Test environment should have its own secrets
   - Never use production secrets in development

3. **Keep dependencies up-to-date**
   - Regularly update npm packages
   - Monitor security advisories
   - Use `npm audit` to check for vulnerabilities

4. **Code review security-sensitive changes**
   - All authentication code should be reviewed
   - Security configurations should be reviewed
   - Environment variable changes should be reviewed

### Production

1. **Use HTTPS everywhere**
   - All authentication traffic must use HTTPS
   - Redirect HTTP to HTTPS
   - Use HSTS to enforce HTTPS

2. **Implement monitoring and alerting**
   - Monitor failed login attempts
   - Alert on suspicious activity
   - Track rate limit violations
   - Monitor API usage patterns

3. **Regular security audits**
   - Review audit logs regularly
   - Conduct penetration testing
   - Review access control policies
   - Update security documentation

4. **Incident response plan**
   - Define incident response procedures
   - Establish communication channels
   - Document escalation paths
   - Conduct incident response drills

### User Education

1. **Password best practices**
   - Encourage strong, unique passwords
   - Recommend password managers
   - Provide password strength feedback
   - Educate on phishing risks

2. **Account security**
   - Encourage email verification
   - Promote secure password reset practices
   - Educate on session management
   - Provide security tips in documentation

---

## Incident Response

### Security Incident Types

1. **Unauthorized Access**
   - Compromised user accounts
   - Brute force attacks
   - Credential stuffing

2. **Data Breach**
   - Exposed user data
   - Leaked secrets
   - Database compromise

3. **Service Disruption**
   - DDoS attacks
   - Rate limit abuse
   - API abuse

### Response Procedures

#### 1. Detection

- Monitor audit logs for suspicious activity
- Set up alerts for failed login attempts
- Track rate limit violations
- Monitor API usage patterns

#### 2. Containment

- Disable compromised accounts
- Rotate compromised secrets
- Block malicious IP addresses
- Implement additional rate limiting

#### 3. Investigation

- Review audit logs
- Identify affected users
- Determine attack vector
- Assess damage

#### 4. Recovery

- Reset compromised passwords
- Notify affected users
- Restore from backups if necessary
- Implement additional security measures

#### 5. Post-Incident

- Document incident details
- Update security procedures
- Conduct post-mortem analysis
- Implement preventive measures

### Contact Information

For security incidents, contact:

- **Email**: security@skillforge.ai (if available)
- **Emergency**: [Define emergency contact]

---

## Security Testing

### Manual Testing

Refer to the design document for comprehensive manual testing checklists:

- Authentication flows (registration, login, logout)
- Password management (change, reset)
- Authorization & access control
- Manager-employee management
- UI & UX security
- Audit & monitoring

### Automated Testing

#### Unit Tests

- Password hashing and verification
- JWT generation and validation
- OTP generation and verification
- Password reset token management
- Rate limiting enforcement

#### Integration Tests

- Complete registration flow
- Complete login flow
- Google OAuth flow
- Password reset flow
- Protected route access
- Role-based UI rendering

#### Security Tests

1. **Password Hashing Strength**
   - Verify bcrypt salt rounds ≥ 10
   - Verify different hashes for same password
   - Benchmark hashing time (~100-300ms)

2. **JWT Token Security**
   - Verify token signature with correct secret
   - Reject token with wrong secret
   - Reject expired token
   - Test token tampering detection

3. **Rate Limiting Effectiveness**
   - Verify login rate limit (5 attempts / 15 min)
   - Verify OTP rate limit (3 requests / hour)
   - Verify password reset rate limit (3 requests / hour)

4. **CORS Policy Enforcement**
   - Allow requests from authorized origins
   - Reject requests from unknown origins

5. **Input Validation & XSS Prevention**
   - Test email injection attempts
   - Test password with special characters
   - Test HTML/script injection in user inputs

### Penetration Testing

Consider conducting regular penetration testing to identify vulnerabilities:

- Authentication bypass attempts
- Session hijacking
- CSRF attacks
- XSS attacks
- SQL injection (N/A for JSON storage)
- API abuse

---

## Reporting Security Issues

If you discover a security vulnerability in SkillForge AI, please report it responsibly:

### Reporting Process

1. **DO NOT** disclose the vulnerability publicly
2. **DO NOT** exploit the vulnerability
3. Email details to: security@skillforge.ai (if available)
4. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if available)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Fix Development**: Depends on severity
- **Disclosure**: After fix is deployed

### Responsible Disclosure

We follow responsible disclosure practices:

- We will acknowledge your report promptly
- We will keep you informed of our progress
- We will credit you for the discovery (if desired)
- We will not take legal action against responsible researchers

---

## Additional Resources

### Documentation

- [Design Document](.kiro/specs/role-based-authentication-system/design.md)
- [Requirements Document](.kiro/specs/role-based-authentication-system/requirements.md)
- [Implementation Tasks](.kiro/specs/role-based-authentication-system/tasks.md)

### External Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [bcrypt Documentation](https://github.com/kelektiv/node.bcrypt.js)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

---

## Version History

| Version | Date       | Changes                        |
| ------- | ---------- | ------------------------------ |
| 1.0     | 2024-01-XX | Initial security documentation |

---

**Last Updated**: 2024-01-XX  
**Maintained By**: SkillForge AI Security Team
