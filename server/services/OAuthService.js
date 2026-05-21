/**
 * OAuthService - Handles OAuth authentication
 * - Google OAuth 2.0 integration
 * - Token exchange
 * - User profile extraction
 */
class OAuthService {
  constructor() {
    this.googleClientId = process.env.GOOGLE_CLIENT_ID;
    this.googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    this.googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/oauth/google/callback';
    this.googleAuthUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    this.googleTokenUrl = 'https://oauth2.googleapis.com/token';
    this.googleUserInfoUrl = 'https://www.googleapis.com/oauth2/v2/userinfo';
  }

  /**
   * Check if Google OAuth is configured
   * @returns {boolean}
   */
  isGoogleConfigured() {
    return !!(this.googleClientId && this.googleClientSecret);
  }

  /**
   * Generate Google OAuth authorization URL
   * @returns {string} Authorization URL
   */
  getGoogleAuthURL() {
    if (!this.isGoogleConfigured()) {
      throw new Error('Google OAuth not configured');
    }

    const params = new URLSearchParams({
      client_id: this.googleClientId,
      redirect_uri: this.googleRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'consent'
    });

    return `${this.googleAuthUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code from Google
   * @returns {Promise<Object>} Token response
   */
  async exchangeCodeForTokens(code) {
    if (!this.isGoogleConfigured()) {
      throw new Error('Google OAuth not configured');
    }

    const params = new URLSearchParams({
      code,
      client_id: this.googleClientId,
      client_secret: this.googleClientSecret,
      redirect_uri: this.googleRedirectUri,
      grant_type: 'authorization_code'
    });

    try {
      const response = await fetch(this.googleTokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error_description || 'Failed to exchange code for tokens');
      }

      return await response.json();
    } catch (error) {
      console.error('[OAuthService] Error exchanging code for tokens:', error.message);
      throw error;
    }
  }

  /**
   * Get user profile from Google using access token
   * @param {string} accessToken - Google access token
   * @returns {Promise<Object>} User profile
   */
  async getUserProfile(accessToken) {
    try {
      const response = await fetch(this.googleUserInfoUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch user profile');
      }

      const profile = await response.json();
      
      return {
        googleId: profile.id,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        emailVerified: profile.verified_email
      };
    } catch (error) {
      console.error('[OAuthService] Error fetching user profile:', error.message);
      throw error;
    }
  }

  /**
   * Handle complete Google OAuth callback flow
   * @param {string} code - Authorization code from Google
   * @returns {Promise<Object>} User profile data
   */
  async handleGoogleCallback(code) {
    try {
      // Step 1: Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(code);
      
      // Step 2: Get user profile
      const profile = await this.getUserProfile(tokens.access_token);
      
      return {
        success: true,
        profile,
        tokens
      };
    } catch (error) {
      console.error('[OAuthService] Error in Google callback:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default new OAuthService();
