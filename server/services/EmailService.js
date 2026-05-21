import nodemailer from 'nodemailer';

/**
 * EmailService - Handles email sending operations
 * - SMTP configuration
 * - Transactional emails (OTP, password reset, welcome)
 * - Retry logic for transient failures
 */
class EmailService {
  constructor() {
    this.transporter = null;
    this.from = process.env.SMTP_FROM || 'SkillForge AI <noreply@skillforge.ai>';
    this.maxRetries = 3;
    this.retryDelay = 2000; // 2 seconds
    this.initializeTransporter();
  }

  /**
   * Initialize nodemailer transporter with SMTP settings
   */
  initializeTransporter() {
    const smtpConfig = {
      host: process.env.SMTP_HOST || 'smtp.example.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    };

    // Only create transporter if SMTP credentials are configured
    if (process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
      this.transporter = nodemailer.createTransporter(smtpConfig);
    } else {
      console.warn('[EmailService] SMTP credentials not configured. Email sending will be disabled.');
    }
  }

  /**
   * Check if email service is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return this.transporter !== null;
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
  async sendEmail(to, subject, htmlBody, textBody, retryCount = 0) {
    if (!this.isEnabled()) {
      console.log(`[EmailService] Email would be sent to ${to}: ${subject}`);
      console.log(`[EmailService] Text: ${textBody}`);
      return { success: false, error: 'Email service not configured' };
    }

    try {
      const mailOptions = {
        from: this.from,
        to,
        subject,
        text: textBody,
        html: htmlBody
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`[EmailService] Email sent successfully to ${to}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error(`[EmailService] Error sending email to ${to}:`, error.message);

      // Retry logic for transient failures
      if (retryCount < this.maxRetries) {
        console.log(`[EmailService] Retrying... (${retryCount + 1}/${this.maxRetries})`);
        await this.delay(this.retryDelay);
        return await this.sendEmail(to, subject, htmlBody, textBody, retryCount + 1);
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
  async sendOTP(email, otp, expiresInMinutes = 10) {
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

    return await this.sendEmail(email, subject, htmlBody, textBody);
  }

  /**
   * Send password reset email
   * @param {string} email - Recipient email
   * @param {string} resetToken - Password reset token
   * @param {number} expiresInMinutes - Token expiration time in minutes
   * @returns {Promise<Object>} Send result
   */
  async sendPasswordReset(email, resetToken, expiresInMinutes = 60) {
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

    return await this.sendEmail(email, subject, htmlBody, textBody);
  }

  /**
   * Send welcome email
   * @param {string} email - Recipient email
   * @param {string} name - User's name
   * @returns {Promise<Object>} Send result
   */
  async sendWelcomeEmail(email, name) {
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

    return await this.sendEmail(email, subject, htmlBody, textBody);
  }
}

export default new EmailService();
