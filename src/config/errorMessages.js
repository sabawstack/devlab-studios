// src/config/errorMessages.js
// Centralized, user-safe error messages for consistent UX

export const ERROR_MESSAGES = {
  // 404 Errors
  NOT_FOUND: {
    title: 'Page Not Found',
    message: "The page you're looking for doesn't exist or has been moved.",
  },

  // Network Errors
  NETWORK_ERROR: {
    title: 'Connection Error',
    message: 'Unable to connect. Please check your internet and try again.',
  },

  // Server Errors
  SERVER_ERROR: {
    title: 'Server Error',
    message: 'Something went wrong on our end. Please try again later.',
  },

  // Maintenance
  MAINTENANCE_MODE: {
    title: 'Under Maintenance',
    message: 'The site is temporarily offline for updates and will be back shortly.',
    // UX-04: no fixed return time is promised.
    details: 'Please try again a little later. Email still reaches us in the meantime.',
  },

  // Generic/Unknown Errors
  UNKNOWN_ERROR: {
    title: 'Something Went Wrong',
    message: 'An unexpected error occurred. Please try again or contact support.',
  },

  // Validation Errors
  VALIDATION_ERROR: {
    title: 'Validation Failed',
    message: 'Please check your input and try again.',
  },

  // Auth Errors
  AUTH_ERROR: {
    title: 'Authentication Error',
    message: 'Please log in again to continue.',
  },

  // API/Backend Errors (generic fallback)
  API_ERROR: {
    title: 'Request Failed',
    message: 'We could not process your request. Please try again.',
  },

  // Contact Form Specific
  CONTACT_SEND_ERROR: {
    title: 'Could Not Send Message',
    message: 'There was an issue sending your message. Please try again.',
  },

  CONTACT_VALIDATION_ERROR: {
    title: 'Please Review Your Message',
    message: 'Some fields are missing or invalid. Please correct them and try again.',
  },

  // Error Boundary
  ERROR_BOUNDARY: {
    title: 'App Error',
    message: 'Something unexpected happened. Please reload the page or go home.',
  },
}

export const getErrorMessage = (errorType) => {
  return ERROR_MESSAGES[errorType] || ERROR_MESSAGES.UNKNOWN_ERROR
}
