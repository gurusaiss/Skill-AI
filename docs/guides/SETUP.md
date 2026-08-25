# SkillForge AI - Setup Guide

This guide will help you set up SkillForge AI on your local machine and prepare it for deployment.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development Setup](#local-development-setup)
3. [Environment Configuration](#environment-configuration)
4. [Running the Application](#running-the-application)
5. [Testing](#testing)
6. [GitHub Repository Setup](#github-repository-setup)
7. [Deployment](#deployment)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- **npm** (comes with Node.js) or **yarn**
- **Git** - [Download](https://git-scm.com/)
- **OpenAI API Key** (optional, for AI features) - [Get API Key](https://platform.openai.com/api-keys)

### Verify Installation

```bash
node --version  # Should be v18 or higher
npm --version   # Should be 8 or higher
git --version   # Any recent version
```

## Local Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/gurusaiss/auto-ai.git
cd auto-ai
```

### 2. Install Dependencies

The project uses npm workspaces to manage dependencies for both client and server.

```bash
# Install all dependencies (root, client, and server)
npm install
```

This single command will install dependencies for:

- Root workspace
- Client (React frontend)
- Server (Express backend)

### 3. Verify Installation

```bash
# Check if node_modules exist
ls node_modules/
ls client/node_modules/
ls server/node_modules/
```

## Environment Configuration

### 1. Create Environment File

```bash
# Copy the example environment file
cp .env.example .env
```

### 2. Configure Environment Variables

Open `.env` in your text editor and configure the following:

#### Required for Basic Functionality (Static Mode)

```env
PORT=3000
NODE_ENV=development
```

#### Optional for AI Features (Hybrid Mode)

```env
# OpenAI Configuration
OPENAI_API_KEY=your_actual_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1/chat/completions

# LLM Configuration
LLM_PROVIDER=openai
LLM_MAX_RETRIES=3
LLM_TIMEOUT=30000
```

### 3. Get OpenAI API Key (Optional)

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up or log in
3. Navigate to [API Keys](https://platform.openai.com/api-keys)
4. Click "Create new secret key"
5. Copy the key and paste it in your `.env` file

**Note**: The application works without an API key using static content. The API key enables:

- Custom skill generation
- Personalized questions
- AI-generated challenges
- Intelligent reports

## Running the Application

### Development Mode

#### Option 1: Run Both Client and Server Separately (Recommended)

**Terminal 1 - Backend Server:**

```bash
npm run dev:server
# Server will start on http://localhost:3000
```

**Terminal 2 - Frontend Client:**

```bash
npm run dev:client
# Client will start on http://localhost:5173
```

#### Option 2: Run Server Only

```bash
npm run dev
# Runs the backend server only
```

### Access the Application

1. Open your browser
2. Navigate to `http://localhost:5173`
3. You should see the SkillForge AI landing page

### Verify Everything Works

1. **Landing Page**: Should load without errors
2. **Enter a Goal**: Try "Learn React for web development"
3. **Diagnostic Questions**: Should appear (static or AI-generated)
4. **Complete Diagnostic**: Submit answers
5. **View Dashboard**: Should show your learning plan

## Testing

### Run All Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Specific Test Files

```bash
cd server
npm test -- Evaluator.test.js
```

### Test Coverage

The project includes:

- Unit tests for core modules
- Integration tests for API endpoints
- Property-based tests for evaluator logic

## GitHub Repository Setup

### 1. Initialize Git (if not already done)

```bash
git init
```

### 2. Add Remote Repository

```bash
git remote add origin https://github.com/gurusaiss/auto-ai.git
```

### 3. Verify Remote

```bash
git remote -v
```

### 4. Stage Changes

```bash
# Add all files
git add .

# Or add specific files
git add .gitignore README.md .env.example
```

### 5. Commit Changes

```bash
git commit -m "Initial commit: SkillForge AI setup"
```

### 6. Push to GitHub

```bash
# Push to main branch
git push -u origin main

# Or if you're on master branch
git push -u origin master
```

### 7. Verify on GitHub

1. Go to https://github.com/gurusaiss/auto-ai
2. Refresh the page
3. You should see all your files

## Important: Protect Your API Key

### Never Commit Your .env File

The `.gitignore` file is configured to exclude:

- `.env` (your actual environment file with secrets)
- `node_modules/` (dependencies)
- `server/data/*.json` (user session data)
- Build outputs and logs

### If You Accidentally Committed Your API Key

1. **Immediately revoke the key** on OpenAI platform
2. **Generate a new key**
3. **Remove the key from Git history**:
   ```bash
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch .env" \
     --prune-empty --tag-name-filter cat -- --all
   ```
4. **Force push** (use with caution):
   ```bash
   git push origin --force --all
   ```

## Deployment

### Deploy to Vercel (Recommended for Frontend)

1. Install Vercel CLI:

   ```bash
   npm install -g vercel
   ```

2. Deploy:

   ```bash
   cd client
   vercel
   ```

3. Follow the prompts

### Deploy to Heroku (Recommended for Backend)

1. Install Heroku CLI: [Download](https://devcenter.heroku.com/articles/heroku-cli)

2. Login:

   ```bash
   heroku login
   ```

3. Create app:

   ```bash
   heroku create skillforge-ai-backend
   ```

4. Set environment variables:

   ```bash
   heroku config:set OPENAI_API_KEY=your_key_here
   heroku config:set NODE_ENV=production
   ```

5. Deploy:
   ```bash
   git push heroku main
   ```

### Deploy to Railway (Alternative)

1. Go to [Railway.app](https://railway.app/)
2. Connect your GitHub repository
3. Add environment variables in the dashboard
4. Deploy automatically on push

## Troubleshooting

### Port Already in Use

```bash
# Kill process on port 3000 (Windows)
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Kill process on port 5173 (Windows)
netstat -ano | findstr :5173
taskkill /PID <PID> /F
```

### Module Not Found Errors

```bash
# Clear node_modules and reinstall
rm -rf node_modules client/node_modules server/node_modules
npm install
```

### API Key Not Working

1. Verify the key is correct in `.env`
2. Check if the key has credits on OpenAI platform
3. Verify the key has proper permissions
4. Restart the server after changing `.env`

### CORS Errors

The server is configured to allow CORS from `http://localhost:5173`. If you're using a different port, update `server/index.js`:

```javascript
app.use(
  cors({
    origin: "http://localhost:YOUR_PORT",
  }),
);
```

### Database/Session Errors

Session data is stored in `server/data/`. If you encounter issues:

```bash
# Clear all session data (except demo)
cd server/data
rm *.json
# Keep demo_skillforge_2024.json
```

## Development Workflow

### Making Changes

1. **Create a feature branch**:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**

3. **Test your changes**:

   ```bash
   npm test
   ```

4. **Commit your changes**:

   ```bash
   git add .
   git commit -m "Description of changes"
   ```

5. **Push to GitHub**:

   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request** on GitHub

### Keeping Your Fork Updated

```bash
# Add upstream remote (original repo)
git remote add upstream https://github.com/original/repo.git

# Fetch upstream changes
git fetch upstream

# Merge upstream changes
git merge upstream/main
```

## Additional Resources

- [Node.js Documentation](https://nodejs.org/docs/)
- [React Documentation](https://react.dev/)
- [Express.js Documentation](https://expressjs.com/)
- [OpenAI API Documentation](https://platform.openai.com/docs/)
- [Git Documentation](https://git-scm.com/doc)

## Support

If you encounter any issues:

1. Check this troubleshooting guide
2. Search existing GitHub issues
3. Create a new issue with:
   - Description of the problem
   - Steps to reproduce
   - Error messages
   - Your environment (OS, Node version, etc.)

## Next Steps

After setup:

1. ✅ Explore the application features
2. ✅ Try different learning goals
3. ✅ Review the code structure
4. ✅ Run the test suite
5. ✅ Make your first contribution

Happy coding! 🚀
