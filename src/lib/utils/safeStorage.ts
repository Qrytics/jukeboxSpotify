/**
 * Safe wrapper for localStorage and sessionStorage that handles:
 * - Private browsing mode (throws exceptions)
 * - Storage quota exceeded
 * - Disabled storage
 *
 * Returns fallback values instead of throwing, logs warnings in dev mode.
 */

/**
 * "Can we touch this storage at all", not "can we write to it". The probe used to be a test write,
 * so a full quota (which makes `setItem` throw) also disabled every *read* — saved theme and scores
 * silently fell back to defaults even though they were sitting right there. Reading `length` is
 * what throws when storage is genuinely blocked (private mode in old Safari, disabled cookies);
 * writes still get their own try/catch in `setLocalItem` / `setSessionItem`.
 */
function isStorageAvailable(type: 'localStorage' | 'sessionStorage'): boolean {
	try {
		const storage = window[type];
		void storage.length;
		return true;
	} catch {
		return false;
	}
}

const localStorageAvailable = typeof window !== 'undefined' && isStorageAvailable('localStorage');
const sessionStorageAvailable =
	typeof window !== 'undefined' && isStorageAvailable('sessionStorage');

/**
 * Safely get an item from localStorage
 * @param key - Storage key
 * @param fallback - Value to return if storage fails or key doesn't exist
 * @returns Stored value or fallback
 */
export function getLocalItem(key: string, fallback: string | null = null): string | null {
	if (!localStorageAvailable) {
		if (import.meta.env.DEV) {
			console.warn(`localStorage unavailable, using fallback for key "${key}"`);
		}
		return fallback;
	}

	try {
		const value = localStorage.getItem(key);
		return value !== null ? value : fallback;
	} catch (err) {
		if (import.meta.env.DEV) {
			console.warn(`Failed to read from localStorage (key: "${key}"):`, err);
		}
		return fallback;
	}
}

/**
 * Safely set an item in localStorage
 * @param key - Storage key
 * @param value - Value to store
 * @returns true if successful, false otherwise
 */
export function setLocalItem(key: string, value: string): boolean {
	if (!localStorageAvailable) {
		if (import.meta.env.DEV) {
			console.warn(`localStorage unavailable, cannot set key "${key}"`);
		}
		return false;
	}

	try {
		localStorage.setItem(key, value);
		return true;
	} catch (err) {
		if (import.meta.env.DEV) {
			console.warn(`Failed to write to localStorage (key: "${key}"):`, err);
		}
		return false;
	}
}

/**
 * Safely remove an item from localStorage
 * @param key - Storage key
 * @returns true if successful, false otherwise
 */
export function removeLocalItem(key: string): boolean {
	if (!localStorageAvailable) {
		return false;
	}

	try {
		localStorage.removeItem(key);
		return true;
	} catch (err) {
		if (import.meta.env.DEV) {
			console.warn(`Failed to remove from localStorage (key: "${key}"):`, err);
		}
		return false;
	}
}

/**
 * Safely get an item from sessionStorage
 * @param key - Storage key
 * @param fallback - Value to return if storage fails or key doesn't exist
 * @returns Stored value or fallback
 */
export function getSessionItem(key: string, fallback: string | null = null): string | null {
	if (!sessionStorageAvailable) {
		if (import.meta.env.DEV) {
			console.warn(`sessionStorage unavailable, using fallback for key "${key}"`);
		}
		return fallback;
	}

	try {
		const value = sessionStorage.getItem(key);
		return value !== null ? value : fallback;
	} catch (err) {
		if (import.meta.env.DEV) {
			console.warn(`Failed to read from sessionStorage (key: "${key}"):`, err);
		}
		return fallback;
	}
}

/**
 * Safely set an item in sessionStorage
 * @param key - Storage key
 * @param value - Value to store
 * @returns true if successful, false otherwise
 */
export function setSessionItem(key: string, value: string): boolean {
	if (!sessionStorageAvailable) {
		if (import.meta.env.DEV) {
			console.warn(`sessionStorage unavailable, cannot set key "${key}"`);
		}
		return false;
	}

	try {
		sessionStorage.setItem(key, value);
		return true;
	} catch (err) {
		if (import.meta.env.DEV) {
			console.warn(`Failed to write to sessionStorage (key: "${key}"):`, err);
		}
		return false;
	}
}

/**
 * Safely remove an item from sessionStorage
 * @param key - Storage key
 * @returns true if successful, false otherwise
 */
export function removeSessionItem(key: string): boolean {
	if (!sessionStorageAvailable) {
		return false;
	}

	try {
		sessionStorage.removeItem(key);
		return true;
	} catch (err) {
		if (import.meta.env.DEV) {
			console.warn(`Failed to remove from sessionStorage (key: "${key}"):`, err);
		}
		return false;
	}
}
