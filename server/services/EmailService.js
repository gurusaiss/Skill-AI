import { createRequire } from 'module';
import { lookup as dnsLookup } from 'dns';
const require = createRequire(import.meta.url);
const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.mailjetApiKey = process.env.MAILJET_API_KEY || process.env.SMTP_USER;
    this.mailjetSecretKey = process.env.MAILJET_SECRET_KEY || process.env.SMTP_PASSWORD;
    this.useMailjetApi = !!(
      process.env.MAILJET_API_KEY ||
      (process.env.SMTP_HOST && process.env.SMTP_HOST.includes('mailjet'))
    );
    this.from = process.env.SMTP_FROM || 'SkillForge AI <noreply@skillforge.ai>';
    this.maxRetries = 1;
    this.retryDelay = 3000;
    if (!this.useMailjetApi) this._initSmtp();
    else console.log('[EmailService] Mailjet HTTP API mode — SMTP bypassed');
  }

  _initSmtp() {
    const smtpHostname = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '587');
    if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      console.warn('[EmailService] SMTP credentials not configured.');
      return;
    }
    const ipv4Lookup = (hostname, options, callback) => {
      dnsLookup(hostname, { ...options, family: 4 }, callback);
    };
    this.transporter = nodemailer.createTransport({
      host: smtpHostname,
      port,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      lookup: ipv4Lookup,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 15000,
    });
    console.log(`[EmailService] SMTP configured → ${smtpHostname}:${port}`);
  }

  isEnabled() {
    return this.useMailjetApi
      ? !!(this.mailjetApiKey && this.mailjetSecretKey)
      : this.transporter !== null;
  }

  // Send via Mailjet REST API (HTTPS — never blocked by Render)
  async _sendViaMailjetApi(to, subject, htmlBody, textBody, fromOverride, replyTo) {
    const fromRaw = fromOverride || this.from;
    // Parse "Name <email>" or plain email
    const match = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
    const fromName = match ? match[1].trim() : 'SkillForge AI';
    const fromEmail = match ? match[2].trim() : fromRaw.trim();

    const payload = {
      Messages: [{
        From: { Email: fromEmail, Name: fromName },
        To: [{ Email: to }],
        Subject: subject,
        HTMLPart: htmlBody,
        TextPart: textBody || '',
        ...(replyTo ? { ReplyTo: { Email: replyTo } } : {}),
      }],
    };

    const auth = Buffer.from(`${this.mailjetApiKey}:${this.mailjetSecretKey}`).toString('base64');
    const body = JSON.stringify(payload);

    const response = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body,
    });

    const result = await response.json();
    if (!response.ok || result.Messages?.[0]?.Status !== 'success') {
      const errMsg = result.Messages?.[0]?.Errors?.[0]?.ErrorMessage
        || result.ErrorMessage
        || `HTTP ${response.status}`;
      throw new Error(errMsg);
    }
    return result.Messages[0].To[0].MessageID;
  }

  /**
   * Send email with retry logic
   * @param {string} to - Recipient email
   * @param {string} subject - Email subject
   * @param {string} htmlBody - HTML email body
   * @param {string} textBody - Plain text email body
   * @param {number} retryCount - Current retry attempt
   * @returns {Promise<Object>} Send result
   */
  // ── Resend HTTP API (bypasses SMTP entirely — works from any cloud provider) ──
  _resendRequest(payload) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const req = https.request({
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ success: true, messageId: parsed.id });
            } else {
              resolve({ success: false, error: parsed.message || `HTTP ${res.statusCode}: ${raw}` });
            }
          } catch {
            resolve({ success: false, error: `Resend parse error: ${raw}` });
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(20000, () => req.destroy(new Error('Resend API timeout')));
      req.write(body);
      req.end();
    });
  }

  async sendEmail(to, subject, htmlBody, textBody, retryCount = 0, fromOverride = null, replyTo = null) {
    // Mailjet HTTP API — works from any cloud provider (SMTP is blocked on Render free tier)
    if (this.useMailjetApi) {
      if (!this.isEnabled()) return { success: false, error: 'Mailjet credentials not configured' };
      try {
        const messageId = await this._sendViaMailjetApi(to, subject, htmlBody, textBody, fromOverride, replyTo);
        console.log(`[EmailService] Mailjet API: sent to ${to} (id:${messageId})`);
        return { success: true, messageId };
      } catch (err) {
        console.error(`[EmailService] Mailjet API error → ${to}:`, err.message);
        if (retryCount < this.maxRetries) {
          await this.delay(this.retryDelay);
          return this.sendEmail(to, subject, htmlBody, textBody, retryCount + 1, fromOverride, replyTo);
        }
        return { success: false, error: err.message };
      }
    }

    // Resend HTTP API fallback
    if (process.env.RESEND_API_KEY) {
      const from = fromOverride || process.env.RESEND_FROM || this.from;
      const payload = { from, to: Array.isArray(to) ? to : [to], subject, html: htmlBody, text: textBody };
      if (replyTo) payload.reply_to = replyTo;
      try {
        const result = await this._resendRequest(payload);
        if (result.success) console.log(`[EmailService] Resend OK → ${to}: ${result.messageId}`);
        else console.error(`[EmailService] Resend failed → ${to}: ${result.error}`);
        return result;
      } catch (err) {
        console.error(`[EmailService] Resend error → ${to}:`, err.message);
        return { success: false, error: err.message };
      }
    }

    // SMTP fallback
    if (!this.isEnabled()) {
      console.log(`[EmailService] Email would be sent to ${to}: ${subject}`);
      return { success: false, error: 'Email service not configured' };
    }

    try {
      const mailOptions = { from: fromOverride || this.from, to, subject, text: textBody, html: htmlBody };
      if (replyTo) mailOptions.replyTo = replyTo;
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`[EmailService] Email sent to ${to}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error(`[EmailService] Error sending email to ${to}:`, error.message);
      if (retryCount < this.maxRetries) {
        await this.delay(this.retryDelay);
        return this.sendEmail(to, subject, htmlBody, textBody, retryCount + 1, fromOverride, replyTo);
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Delay helper for retry logic
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Transactional Email Methods
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Send OTP verification email
   * @param {string} email - Recipient email
   * @param {string} otp - 6-digit OTP code
   * @param {number} expiresInMinutes - OTP expiration time in minutes
   * @returns {Promise<Object>} Send result
   */
  async sendOTP(email, otp, expiresInMinutes = 10, { fromEmail, fromName } = {}) {
    const subject = 'Verify Your Email - SkillForge AI';
    
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
    .otp-code { font-size: 36px; font-weight: bold; color: #6366f1; text-align: center; letter-spacing: 8px; margin: 30px 0; padding: 20px; background: white; border-radius: 8px; border: 2px dashed #6366f1; }
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Verify Your Email</h1>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>Thank you for registering with SkillForge AI! To complete your registration, please verify your email address using the code below:</p>
      <div class="otp-code">${otp}</div>
      <p><strong>This code will expire in ${expiresInMinutes} minutes.</strong></p>
      <p>If you didn't request this code, please ignore this email.</p>
      <p>Best regards,<br>The SkillForge AI Team</p>
    </div>
    <div class="footer">
      <p>This is an automated message, please do not reply.</p>
    </div>
  </div>
</body>
</html>
    `;

    const textBody = `
Verify Your Email - SkillForge AI

Hello,

Thank you for registering with SkillForge AI! To complete your registration, please verify your email address using the code below:

Your verification code: ${otp}

This code will expire in ${expiresInMinutes} minutes.

If you didn't request this code, please ignore this email.

Best regards,
The SkillForge AI Team
    `;

    return await this.sendEmail(email, subject, htmlBody, textBody, 0, null, fromEmail || null);
  }

  /**
   * Send password reset email
   * @param {string} email - Recipient email
   * @param {string} resetToken - Password reset token
   * @param {number} expiresInMinutes - Token expiration time in minutes
   * @returns {Promise<Object>} Send result
   */
  async sendPasswordReset(email, resetToken, expiresInMinutes = 60, { fromEmail, fromName } = {}) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;
    
    const subject = 'Reset Your Password - SkillForge AI';
    
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; padding: 15px 30px; background: #6366f1; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Reset Your Password</h1>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>We received a request to reset your password for your SkillForge AI account. Click the button below to reset your password:</p>
      <div style="text-align: center;">
        <a href="${resetLink}" class="button">Reset Password</a>
      </div>
      <p><strong>This link will expire in ${expiresInMinutes} minutes.</strong></p>
      <p>If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
      <p>For security reasons, this link can only be used once.</p>
      <p>Best regards,<br>The SkillForge AI Team</p>
    </div>
    <div class="footer">
      <p>If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="word-break: break-all;">${resetLink}</p>
    </div>
  </div>
</body>
</html>
    `;

    const textBody = `
Reset Your Password - SkillForge AI

Hello,

We received a request to reset your password for your SkillForge AI account. Click the link below to reset your password:

${resetLink}

This link will expire in ${expiresInMinutes} minutes.

If you didn't request a password reset, please ignore this email. Your password will remain unchanged.

For security reasons, this link can only be used once.

Best regards,
The SkillForge AI Team
    `;

    return await this.sendEmail(email, subject, htmlBody, textBody, 0, null, fromEmail || null);
  }

  /**
   * Send welcome email
   * @param {string} email - Recipient email
   * @param {string} name - User's name
   * @returns {Promise<Object>} Send result
   */
  async sendWelcomeEmail(email, name, { fromEmail, fromName } = {}) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const subject = 'Welcome to SkillForge AI!';
    
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; padding: 15px 30px; background: #6366f1; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
    .feature { margin: 15px 0; padding: 15px; background: white; border-radius: 8px; }
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to SkillForge AI!</h1>
    </div>
    <div class="content">
      <p>Hello ${name},</p>
      <p>Welcome to SkillForge AI - your intelligent, adaptive learning platform powered by multi-agent AI!</p>
      <p>Your account has been successfully created and verified. You're now ready to start your learning journey.</p>
      
      <h3>What's Next?</h3>
      <div class="feature">
        <strong>1. Set Your Learning Goal</strong><br>
        Tell us what you want to learn, and our AI agents will create a personalized skill tree.
      </div>
      <div class="feature">
        <strong>2. Complete Your Diagnostic</strong><br>
        Take a quick assessment so we can understand your current skill level.
      </div>
      <div class="feature">
        <strong>3. Start Learning</strong><br>
        Follow your personalized learning plan with adaptive challenges and real-time feedback.
      </div>
      
      <div style="text-align: center;">
        <a href="${frontendUrl}/dashboard" class="button">Go to Dashboard</a>
      </div>
      
      <p>If you have any questions, feel free to reach out to our support team.</p>
      <p>Happy learning!<br>The SkillForge AI Team</p>
    </div>
    <div class="footer">
      <p>This is an automated message, please do not reply.</p>
    </div>
  </div>
</body>
</html>
    `;

    const textBody = `
Welcome to SkillForge AI!

Hello ${name},

Welcome to SkillForge AI - your intelligent, adaptive learning platform powered by multi-agent AI!

Your account has been successfully created and verified. You're now ready to start your learning journey.

What's Next?

1. Set Your Learning Goal
   Tell us what you want to learn, and our AI agents will create a personalized skill tree.

2. Complete Your Diagnostic
   Take a quick assessment so we can understand your current skill level.

3. Start Learning
   Follow your personalized learning plan with adaptive challenges and real-time feedback.

Get started: ${frontendUrl}/dashboard

If you have any questions, feel free to reach out to our support team.

Happy learning!
The SkillForge AI Team
    `;

    return await this.sendEmail(email, subject, htmlBody, textBody, 0, null, fromEmail || null);
  }

  async sendInvitationEmail(email, { name, role, companyName, activationUrl, fromEmail, fromName }) {
    const subject = `${name ? name + ', you' : 'You'}'ve been invited to ${companyName || 'SkillForge AI'} — Activate Your Account`;
    const displayRole = (role || 'Employee').charAt(0).toUpperCase() + (role || 'Employee').slice(1);
    const displayCompany = companyName || 'SkillForge AI';
    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%);border-radius:12px 12px 0 0;padding:40px 48px;text-align:center;">
          <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:50%;width:64px;height:64px;line-height:64px;font-size:28px;margin-bottom:16px;">⚡</div>
          <h1 style="margin:0;color:#fff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Welcome to ${displayCompany}</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.80);font-size:15px;">Your AI-powered learning journey starts here</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:40px 48px;">
          <p style="margin:0 0 20px;font-size:16px;color:#374151;">Hi <strong>${name || 'there'}</strong>,</p>
          <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.7;">
            You've been added to <strong>${displayCompany}</strong>'s workforce development platform as a
            <span style="display:inline-block;background:#EEF2FF;color:#4F46E5;border-radius:20px;padding:2px 12px;font-size:13px;font-weight:600;">${displayRole}</span>.
            Click below to set your password and activate your account.
          </p>

          <!-- Feature highlights -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
            <tr>
              <td width="33%" style="padding:16px 8px 16px 0;vertical-align:top;">
                <div style="background:#F8FAFC;border-radius:10px;padding:20px 16px;text-align:center;">
                  <div style="font-size:24px;margin-bottom:8px;">🎯</div>
                  <div style="font-size:13px;font-weight:600;color:#1E293B;">Skill Assessments</div>
                  <div style="font-size:12px;color:#64748B;margin-top:4px;">Know exactly where you stand</div>
                </div>
              </td>
              <td width="33%" style="padding:16px 4px;vertical-align:top;">
                <div style="background:#F8FAFC;border-radius:10px;padding:20px 16px;text-align:center;">
                  <div style="font-size:24px;margin-bottom:8px;">🤖</div>
                  <div style="font-size:13px;font-weight:600;color:#1E293B;">AI Learning Paths</div>
                  <div style="font-size:12px;color:#64748B;margin-top:4px;">Personalized just for you</div>
                </div>
              </td>
              <td width="33%" style="padding:16px 0 16px 8px;vertical-align:top;">
                <div style="background:#F8FAFC;border-radius:10px;padding:20px 16px;text-align:center;">
                  <div style="font-size:24px;margin-bottom:8px;">📈</div>
                  <div style="font-size:13px;font-weight:600;color:#1E293B;">Track Progress</div>
                  <div style="font-size:12px;color:#64748B;margin-top:4px;">See your growth in real time</div>
                </div>
              </td>
            </tr>
          </table>

          <!-- CTA Button -->
          <div style="text-align:center;margin:0 0 28px;">
            <a href="${activationUrl}"
               style="display:inline-block;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#ffffff;text-decoration:none;padding:16px 48px;border-radius:8px;font-size:16px;font-weight:700;letter-spacing:0.3px;box-shadow:0 4px 14px rgba(79,70,229,0.4);">
              Activate My Account →
            </a>
          </div>

          <!-- Expiry notice -->
          <div style="background:#FEF3C7;border-left:4px solid #F59E0B;border-radius:0 6px 6px 0;padding:12px 16px;margin-bottom:28px;">
            <p style="margin:0;font-size:13px;color:#92400E;">
              ⏰ <strong>This link expires in 72 hours.</strong> Please activate your account before it expires.
            </p>
          </div>

          <!-- Fallback link -->
          <p style="margin:0 0 24px;font-size:13px;color:#94A3B8;">
            Button not working? Copy and paste this link into your browser:<br>
            <a href="${activationUrl}" style="color:#4F46E5;word-break:break-all;">${activationUrl}</a>
          </p>

          <hr style="border:none;border-top:1px solid #E2E8F0;margin:0 0 24px;">
          <p style="margin:0;font-size:13px;color:#94A3B8;">
            If you weren't expecting this invitation, you can safely ignore this email — no account will be created without your activation.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#F8FAFC;border-radius:0 0 12px 12px;padding:24px 48px;text-align:center;border-top:1px solid #E2E8F0;">
          <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#4F46E5;">⚡ SkillForge AI</p>
          <p style="margin:0;font-size:12px;color:#94A3B8;">AI-Powered Workforce Development Platform</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const textBody = `Hi ${name || 'there'},

You've been invited to join ${displayCompany} as ${displayRole}.

Activate your account (link expires in 72 hours):
${activationUrl}

What you get access to:
- Skill assessments to know where you stand
- AI-powered personalized learning paths
- Real-time progress tracking

If you weren't expecting this, you can safely ignore this email.

— SkillForge AI Team`;

    const replyTo = fromEmail || null;
    return await this.sendEmail(email, subject, htmlBody, textBody, 0, null, replyTo);
  }
}

export default new EmailService();
