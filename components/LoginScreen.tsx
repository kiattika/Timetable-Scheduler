
import React, { useState, useEffect } from 'react';
import { Icons, APP_TITLE } from '../constants';
import { googleSignIn, takeRedirectSignInError } from '../lib/firebase';
import { User as FirebaseUser } from 'firebase/auth';

interface LoginScreenProps {
  onLoginSuccess?: (user: FirebaseUser, token: string | null) => void; // legacy (redirect flow completes via onAuthStateChanged)
  onLoginFailure?: (error: string) => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginFailure }) => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Surface an error from a redirect sign-in that failed after navigating away.
  useEffect(() => {
    const e = takeRedirectSignInError();
    if (e) setError(e);
  }, []);

  const handleGoogleLogin = async () => {
    setError(null);
    setIsLoading(true);
    try {
      // Full-page redirect to Google. On success the browser navigates away and
      // this component unmounts; the app re-loads, completeRedirectSignIn() +
      // onAuthStateChanged take over. `isLoading` stays true until navigation.
      await googleSignIn();
    } catch (err: any) {
      // Only reached if the redirect could not even start.
      console.error('Login failed:', err);
      const errorMessage = err.message || 'Failed to start Google sign-in.';
      setError(errorMessage);
      if (onLoginFailure) onLoginFailure(errorMessage);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white shadow-xl rounded-lg p-8 md:p-10">
          <div className="flex justify-center mb-6">
            <Icons.Schedule size={48} className="text-blue-600" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-center text-slate-800 mb-2">
            {APP_TITLE}
          </h1>
          <p className="text-center text-slate-500 mb-8 text-sm">
            Please sign in to continue.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-md relative mb-6 text-sm" role="alert">
              <strong className="font-semibold">Login Failed:</strong>
              <span className="block sm:inline ml-1">{error}</span>
            </div>
          )}

          <div className="space-y-6 flex flex-col items-center">
            <button 
              onClick={handleGoogleLogin} 
              disabled={isLoading}
              className="gsi-material-button w-full sm:w-auto"
            >
              <div className="gsi-material-button-state"></div>
              <div className="gsi-material-button-content-wrapper flex justify-center items-center py-2 px-4 border border-gray-300 rounded shadow-sm hover:bg-gray-50 transition-colors">
                <div className="gsi-material-button-icon mr-3">
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" xmlnsXlink="http://www.w3.org/1999/xlink" style={{display: 'block', width: '20px', height: '20px'}}>
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                    <path fill="none" d="M0 0h48v48H0z"></path>
                  </svg>
                </div>
                <span className="gsi-material-button-contents font-medium text-gray-700">
                  {isLoading ? 'Signing In...' : 'Sign in with Google'}
                </span>
              </div>
            </button>
          </div>
        </div>
        <p className="text-center text-xs text-slate-500 mt-6">
          © {new Date().getFullYear()} Timetable Scheduler. All rights reserved.
        </p>
      </div>
    </div>
  );
};

export default LoginScreen;
