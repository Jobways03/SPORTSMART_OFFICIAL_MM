'use client';

import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ApiError } from '@/lib/api-client';
import {
  sellerProfileService,
  SellerProfileData,
  UpdateProfilePayload,
} from '@/services/profile.service';
import {
  validateProfileSellerName,
  validateProfileShopName,
  validateCountryCode,
  validateContactNumber,
  validatePhoneCrossField,
  validateStoreAddress,
  validateCity,
  validateState,
  validateCountry,
  validateZipCode,
  validateRichText,
  validateImageFile,
  isEditorEmpty,
  getPlainTextLength,
} from '@/lib/profile-validators';
import './profile.css';

const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });
import 'react-quill-new/dist/quill.snow.css';

// --- Constants ---
const COUNTRY_CODES = [
  '+91', '+1', '+44', '+61', '+81', '+86', '+49', '+33', '+39', '+7',
  '+55', '+52', '+34', '+82', '+65', '+60', '+62', '+66', '+971', '+966',
];

const QUILL_MODULES = {
  toolbar: [
    ['bold', 'italic', 'underline', 'strike'],
    [{ header: [2, 3, false] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['blockquote', 'link'],
    ['clean'],
  ],
};

const QUILL_FORMATS = [
  'bold', 'italic', 'underline', 'strike',
  'header', 'list', 'blockquote', 'link',
];

// --- Types ---
interface FormData {
  sellerName: string;
  sellerShopName: string;
  sellerContactCountryCode: string;
  sellerContactNumber: string;
  storeAddress: string;
  locality: string;
  city: string;
  state: string;
  country: string;
  sellerZipCode: string;
  shortStoreDescription: string;
  detailedStoreDescription: string;
  sellerPolicy: string;
}

interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

type FormErrors = Partial<Record<keyof FormData | 'phone', string>>;

// --- Helpers ---
// What the user sees in the form (with sensible defaults)
function profileToFormData(p: SellerProfileData): FormData {
  return {
    sellerName: p.sellerName || '',
    sellerShopName: p.sellerShopName || '',
    sellerContactCountryCode: p.sellerContactCountryCode || '+91',
    sellerContactNumber: p.sellerContactNumber || p.phoneNumber || '',
    storeAddress: p.storeAddress || '',
    locality: (p as any).locality || '',
    city: p.city || '',
    state: p.state || '',
    country: p.country || 'India',
    sellerZipCode: p.sellerZipCode || '',
    shortStoreDescription: p.shortStoreDescription || '',
    detailedStoreDescription: p.detailedStoreDescription || '',
    sellerPolicy: p.sellerPolicy || '',
  };
}

// What the backend actually has (nulls become empty strings)
function profileToInitialData(p: SellerProfileData): FormData {
  return {
    sellerName: p.sellerName || '',
    sellerShopName: p.sellerShopName || '',
    sellerContactCountryCode: p.sellerContactCountryCode || '',
    sellerContactNumber: p.sellerContactNumber || '',
    storeAddress: p.storeAddress || '',
    locality: (p as any).locality || '',
    city: p.city || '',
    state: p.state || '',
    country: p.country || '',
    sellerZipCode: p.sellerZipCode || '',
    shortStoreDescription: p.shortStoreDescription || '',
    detailedStoreDescription: p.detailedStoreDescription || '',
    sellerPolicy: p.sellerPolicy || '',
  };
}

function computeDiff(current: FormData, initial: FormData): UpdateProfilePayload {
  const diff: UpdateProfilePayload = {};
  const keys = Object.keys(current) as (keyof FormData)[];
  for (const key of keys) {
    if (current[key] !== initial[key]) {
      (diff as Record<string, string>)[key] = current[key];
    }
  }
  // Cross-field: if one of country code / phone changed, send both
  if (diff.sellerContactCountryCode !== undefined && diff.sellerContactNumber === undefined) {
    diff.sellerContactNumber = current.sellerContactNumber;
  }
  if (diff.sellerContactNumber !== undefined && diff.sellerContactCountryCode === undefined) {
    diff.sellerContactCountryCode = current.sellerContactCountryCode;
  }
  return diff;
}

function getStatusBadgeClass(status: string): string {
  return `status-badge status-${status.toLowerCase()}`;
}

function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: 'Active',
    INACTIVE: 'Inactive',
    PENDING_APPROVAL: 'Pending Approval',
    SUSPENDED: 'Suspended',
    DEACTIVATED: 'Deactivated',
  };
  return map[status] || status;
}

function isReadOnly(status: string): boolean {
  return status === 'SUSPENDED' || status === 'DEACTIVATED';
}

function isContentRestricted(status: string): boolean {
  return status === 'INACTIVE';
}

function isMediaRestricted(status: string): boolean {
  return status === 'SUSPENDED' || status === 'DEACTIVATED';
}

// --- Component ---
export default function SellerProfilePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);

  // Profile state
  const [profile, setProfile] = useState<SellerProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<FormData>({
    sellerName: '', sellerShopName: '',
    sellerContactCountryCode: '', sellerContactNumber: '',
    storeAddress: '', locality: '', city: '', state: '', country: '', sellerZipCode: '',
    shortStoreDescription: '', detailedStoreDescription: '', sellerPolicy: '',
  });
  const [initialFormData, setInitialFormData] = useState<FormData | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Media state
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [shopLogoUrl, setShopLogoUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingImage, setRemovingImage] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  // Completion
  const [completion, setCompletion] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  // Pincode auto-fill state
  const [pincodeData, setPincodeData] = useState<{ district: string; state: string; places: { name: string; type: string; delivery: string }[] } | null>(null);
  const [pincodeLoading, setPincodeLoading] = useState(false);
  const [pincodeError, setPincodeError] = useState('');
  const [selectedPlace, setSelectedPlace] = useState('');
  const [pincodeAutoFilled, setPincodeAutoFilled] = useState(false);

  async function lookupPincode(pincode: string) {
    if (pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
      setPincodeData(null);
      setPincodeError('');
      setPincodeAutoFilled(false);
      setSelectedPlace('');
      return;
    }

    setPincodeLoading(true);
    setPincodeError('');
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const res = await fetch(`${API_BASE}/api/v1/pincodes/${pincode}`);
      const data = await res.json();

      if (data.success && data.data) {
        setPincodeData(data.data);
        setPincodeAutoFilled(true);
        setSelectedPlace('');
        setFormData(prev => ({
          ...prev,
          city: data.data.district,
          state: data.data.state,
          locality: '',
        }));
        // Clear any city/state errors
        setErrors(prev => {
          const next = { ...prev };
          delete next.city;
          delete next.state;
          return next;
        });
      } else {
        setPincodeError('Invalid pincode');
        setPincodeData(null);
        setPincodeAutoFilled(false);
        setSelectedPlace('');
      }
    } catch {
      setPincodeError('Failed to lookup pincode');
      setPincodeData(null);
      setPincodeAutoFilled(false);
    } finally {
      setPincodeLoading(false);
    }
  }

  // Email verification
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpValue, setOtpValue] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);

  // Change password
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pwCurrentPassword, setPwCurrentPassword] = useState('');
  const [pwNewPassword, setPwNewPassword] = useState('');
  const [pwConfirmPassword, setPwConfirmPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwFieldErrors, setPwFieldErrors] = useState<Record<string, string>>({});
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  // Toast
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  // File inputs
  const imageInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // --- Auth check ---
  useEffect(() => {
    try {
      const t = sessionStorage.getItem('accessToken');
      if (!t) { router.replace('/login'); return; }
      setToken(t);
    } catch {
      router.replace('/login');
    }
  }, [router]);

  // --- Toasts ---
  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = ++toastId.current;
    setToasts(prev => [...prev.slice(-2), { id, type, message }]);
    if (type === 'success' || type === 'info') {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 4000);
    }
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // --- Fetch profile ---
  const fetchProfile = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setFetchError(null);
    try {
      const result = await sellerProfileService.getProfile(token);
      if (result.data) {
        setProfile(result.data);
        setFormData(profileToFormData(result.data));
        setInitialFormData(profileToInitialData(result.data));
        setProfileImageUrl(result.data.sellerProfileImageUrl);
        setShopLogoUrl(result.data.sellerShopLogoUrl);
        setCompletion(result.data.profileCompletionPercentage);
        setIsComplete(result.data.isProfileCompleted);
        setIsEmailVerified(result.data.isEmailVerified);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setFetchError('Failed to load profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [token, router]);

  useEffect(() => {
    if (token) fetchProfile();
  }, [token, fetchProfile]);

  // No auto-lookup on load — only show dropdown when user changes pincode

  // --- Email verification ---
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timer = setInterval(() => {
      setOtpCooldown(prev => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCooldown]);

  const handleSendVerificationOtp = useCallback(async () => {
    if (!token || sendingOtp || otpCooldown > 0) return;
    setSendingOtp(true);
    setOtpError(null);
    try {
      await sellerProfileService.sendEmailVerificationOtp(token);
      setShowOtpModal(true);
      setOtpValue('');
      setOtpCooldown(60);
      addToast('success', 'Verification OTP sent to your email');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) { router.replace('/login'); return; }
        const msg = Array.isArray(err.body.message) ? err.body.message[0] : err.body.message;
        addToast('error', typeof msg === 'string' ? msg : 'Failed to send OTP');
      } else {
        addToast('error', 'Failed to send verification OTP');
      }
    } finally {
      setSendingOtp(false);
    }
  }, [token, sendingOtp, otpCooldown, addToast, router]);

  const handleVerifyEmail = useCallback(async () => {
    if (!token || verifyingOtp) return;
    const trimmed = otpValue.trim();
    if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
      setOtpError('Enter a valid 6-digit OTP');
      return;
    }
    setVerifyingOtp(true);
    setOtpError(null);
    try {
      await sellerProfileService.verifyEmail(token, trimmed);
      setIsEmailVerified(true);
      setShowOtpModal(false);
      setOtpValue('');
      addToast('success', 'Email verified successfully!');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          const msg = Array.isArray(err.body.message) ? err.body.message[0] : err.body.message;
          setOtpError(typeof msg === 'string' ? msg : 'Invalid or expired OTP');
        } else {
          const msg = Array.isArray(err.body.message) ? err.body.message[0] : err.body.message;
          setOtpError(typeof msg === 'string' ? msg : 'Verification failed');
        }
      } else {
        setOtpError('Verification failed. Please try again.');
      }
    } finally {
      setVerifyingOtp(false);
    }
  }, [token, otpValue, verifyingOtp, addToast, router]);

  // --- Change password ---
  const openPasswordModal = useCallback(() => {
    setPwCurrentPassword('');
    setPwNewPassword('');
    setPwConfirmPassword('');
    setPwError(null);
    setPwFieldErrors({});
    setShowCurrentPw(false);
    setShowNewPw(false);
    setShowConfirmPw(false);
    setShowPasswordModal(true);
  }, []);

  const validatePasswordFields = (): boolean => {
    const errs: Record<string, string> = {};
    if (!pwCurrentPassword) errs.currentPassword = 'Current password is required';
    if (!pwNewPassword) {
      errs.newPassword = 'New password is required';
    } else if (pwNewPassword.length < 8) {
      errs.newPassword = 'Must be at least 8 characters';
    } else if (!/(?=.*[a-z])/.test(pwNewPassword)) {
      errs.newPassword = 'Must include a lowercase letter';
    } else if (!/(?=.*[A-Z])/.test(pwNewPassword)) {
      errs.newPassword = 'Must include an uppercase letter';
    } else if (!/(?=.*\d)/.test(pwNewPassword)) {
      errs.newPassword = 'Must include a number';
    } else if (!/(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/.test(pwNewPassword)) {
      errs.newPassword = 'Must include a special character';
    }
    if (!pwConfirmPassword) {
      errs.confirmPassword = 'Please confirm your password';
    } else if (pwNewPassword && pwNewPassword !== pwConfirmPassword) {
      errs.confirmPassword = 'Passwords do not match';
    }
    if (pwCurrentPassword && pwNewPassword && pwCurrentPassword === pwNewPassword) {
      errs.newPassword = 'New password must be different from current password';
    }
    setPwFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleChangePassword = useCallback(async () => {
    if (!token || pwSubmitting) return;
    if (!validatePasswordFields()) return;

    setPwSubmitting(true);
    setPwError(null);
    try {
      await sellerProfileService.changePassword(token, pwCurrentPassword, pwNewPassword, pwConfirmPassword);
      setShowPasswordModal(false);
      addToast('success', 'Password changed successfully. Please log in again.');
      // Clear session and redirect to login after a brief delay
      setTimeout(() => {
        sessionStorage.clear();
        router.replace('/login');
      }, 1500);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) { router.replace('/login'); return; }
        const msg = Array.isArray(err.body.message) ? err.body.message[0] : err.body.message;
        setPwError(typeof msg === 'string' ? msg : 'Failed to change password');
      } else {
        setPwError('Something went wrong. Please try again.');
      }
    } finally {
      setPwSubmitting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, pwCurrentPassword, pwNewPassword, pwConfirmPassword, pwSubmitting, addToast, router]);

  // --- Unsaved changes guard ---
  const isDirty = initialFormData
    ? Object.keys(formData).some(
        k => formData[k as keyof FormData] !== initialFormData[k as keyof FormData],
      )
    : false;

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // --- Field handlers ---
  const updateField = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error on edit
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    if (field === 'sellerContactCountryCode' || field === 'sellerContactNumber') {
      if (errors.phone) {
        setErrors(prev => {
          const next = { ...prev };
          delete next.phone;
          return next;
        });
      }
    }
  };

  const handleBlur = (field: keyof FormData) => {
    let error: string | null = null;
    const v = formData[field];

    switch (field) {
      case 'sellerName': error = validateProfileSellerName(v); break;
      case 'sellerShopName': error = validateProfileShopName(v); break;
      case 'sellerContactCountryCode': error = validateCountryCode(v); break;
      case 'sellerContactNumber': error = validateContactNumber(v); break;
      case 'storeAddress': error = validateStoreAddress(v); break;
      case 'city': error = validateCity(v); break;
      case 'state': error = validateState(v); break;
      case 'country': error = validateCountry(v); break;
      case 'sellerZipCode': error = validateZipCode(v); break;
    }

    setErrors(prev => {
      const next = { ...prev };
      if (error) next[field] = error; else delete next[field];
      return next;
    });
  };

  // --- Validate all ---
  const validateAll = (): boolean => {
    const newErrors: FormErrors = {};
    const readonly = profile ? isReadOnly(profile.status) : false;
    if (readonly) return true;

    const contentRestricted = profile ? isContentRestricted(profile.status) : false;

    // Basic fields
    const nameErr = validateProfileSellerName(formData.sellerName);
    if (nameErr) newErrors.sellerName = nameErr;
    const shopErr = validateProfileShopName(formData.sellerShopName);
    if (shopErr) newErrors.sellerShopName = shopErr;

    // Phone cross-field
    const codeErr = validateCountryCode(formData.sellerContactCountryCode);
    if (codeErr) newErrors.sellerContactCountryCode = codeErr;
    const phoneErr = validateContactNumber(formData.sellerContactNumber);
    if (phoneErr) newErrors.sellerContactNumber = phoneErr;
    if (!codeErr && !phoneErr) {
      const crossErr = validatePhoneCrossField(
        formData.sellerContactCountryCode,
        formData.sellerContactNumber,
      );
      if (crossErr) newErrors.phone = crossErr;
    }

    // Address — only validate if any address field is filled
    const hasAnyAddress = [
      formData.storeAddress, formData.city, formData.state,
      formData.country, formData.sellerZipCode,
    ].some(v => v.trim().length > 0);

    if (hasAnyAddress) {
      const addrErr = validateStoreAddress(formData.storeAddress);
      if (addrErr) newErrors.storeAddress = addrErr;
      const cityErr = validateCity(formData.city);
      if (cityErr) newErrors.city = cityErr;
      const stateErr = validateState(formData.state);
      if (stateErr) newErrors.state = stateErr;
      const countryErr = validateCountry(formData.country);
      if (countryErr) newErrors.country = countryErr;
      const zipErr = validateZipCode(formData.sellerZipCode);
      if (zipErr) newErrors.sellerZipCode = zipErr;
    }

    // Rich text (only if not content-restricted)
    if (!contentRestricted) {
      if (formData.shortStoreDescription && !isEditorEmpty(formData.shortStoreDescription)) {
        const err = validateRichText(formData.shortStoreDescription, 'Short description', 500);
        if (err) newErrors.shortStoreDescription = err;
      }
      if (formData.detailedStoreDescription && !isEditorEmpty(formData.detailedStoreDescription)) {
        const err = validateRichText(formData.detailedStoreDescription, 'Detailed description', 10000);
        if (err) newErrors.detailedStoreDescription = err;
      }
      if (formData.sellerPolicy && !isEditorEmpty(formData.sellerPolicy)) {
        const err = validateRichText(formData.sellerPolicy, 'Seller policy', 10000);
        if (err) newErrors.sellerPolicy = err;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // --- Save ---
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !profile || !initialFormData) return;
    if (isReadOnly(profile.status)) return;

    if (!validateAll()) {
      const firstError = document.querySelector('[aria-invalid="true"]') as HTMLElement;
      firstError?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      firstError?.focus();
      return;
    }

    const diff = computeDiff(formData, initialFormData);
    if (Object.keys(diff).length === 0) {
      addToast('info', 'No changes to save');
      return;
    }

    setIsSaving(true);
    try {
      const result = await sellerProfileService.updateProfile(token, diff);
      if (result.data) {
        setFormData(profileToFormData(result.data));
        setInitialFormData(profileToInitialData(result.data));
        setProfile(result.data);
        setCompletion(result.data.profileCompletionPercentage);
        setIsComplete(result.data.isProfileCompleted);
        setErrors({});
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 1500);
        addToast('success', 'Profile updated successfully');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) { router.replace('/login'); return; }
        if (err.status === 403) {
          addToast('error', typeof err.body.message === 'string' ? err.body.message : 'You do not have permission to update your profile');
          return;
        }
        if (err.status === 400 || err.status === 422) {
          const msgs = err.body.message;
          const msgArr = Array.isArray(msgs) ? msgs : [msgs];
          // Try to map field errors
          const fieldMap: Record<string, keyof FormErrors> = {
            'seller name': 'sellerName',
            'shop name': 'sellerShopName',
            'country code': 'sellerContactCountryCode',
            'contact number': 'sellerContactNumber',
            'phone': 'sellerContactNumber',
            'store address': 'storeAddress',
            'short description': 'shortStoreDescription',
            'detailed description': 'detailedStoreDescription',
            'policy': 'sellerPolicy',
            'city': 'city',
            'state': 'state',
            'country': 'country',
            'zip': 'sellerZipCode',
          };
          const newErrors: FormErrors = { ...errors };
          let unmapped: string[] = [];
          for (const msg of msgArr) {
            if (typeof msg !== 'string') continue;
            const lower = msg.toLowerCase();
            let matched = false;
            for (const [keyword, field] of Object.entries(fieldMap)) {
              if (lower.includes(keyword)) {
                newErrors[field] = msg;
                matched = true;
                break;
              }
            }
            if (!matched) unmapped.push(msg);
          }
          setErrors(newErrors);
          if (unmapped.length > 0) {
            addToast('error', unmapped.join('. '));
          }
          return;
        }
      }
      addToast('error', 'Something went wrong. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // --- Media upload ---
  const handleImageUpload = async (file: File) => {
    if (!token) return;
    const validationError = validateImageFile(file);
    if (validationError) { setImageError(validationError); return; }

    setImageError(null);
    setUploadingImage(true);
    try {
      const result = await sellerProfileService.uploadProfileImage(token, file);
      if (result.data) {
        setProfileImageUrl(result.data.sellerProfileImageUrl || null);
        setCompletion(result.data.profileCompletionPercentage);
        addToast('success', 'Profile image uploaded successfully');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) { router.replace('/login'); return; }
        const msg = Array.isArray(err.body.message) ? err.body.message[0] : err.body.message;
        setImageError(typeof msg === 'string' ? msg : 'Failed to upload image');
      } else {
        setImageError('Failed to upload image. Please try again.');
      }
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleImageRemove = async () => {
    if (!token) return;
    setImageError(null);
    setRemovingImage(true);
    try {
      const result = await sellerProfileService.deleteProfileImage(token);
      if (result.data) {
        setProfileImageUrl(null);
        setCompletion(result.data.profileCompletionPercentage);
        addToast('success', 'Profile image removed');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { router.replace('/login'); return; }
      addToast('error', 'Failed to remove image. Please try again.');
    } finally {
      setRemovingImage(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    if (!token) return;
    const validationError = validateImageFile(file);
    if (validationError) { setLogoError(validationError); return; }

    setLogoError(null);
    setUploadingLogo(true);
    try {
      const result = await sellerProfileService.uploadShopLogo(token, file);
      if (result.data) {
        setShopLogoUrl(result.data.sellerShopLogoUrl || null);
        setCompletion(result.data.profileCompletionPercentage);
        addToast('success', 'Shop logo uploaded successfully');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) { router.replace('/login'); return; }
        const msg = Array.isArray(err.body.message) ? err.body.message[0] : err.body.message;
        setLogoError(typeof msg === 'string' ? msg : 'Failed to upload logo');
      } else {
        setLogoError('Failed to upload logo. Please try again.');
      }
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleLogoRemove = async () => {
    if (!token) return;
    setLogoError(null);
    setRemovingLogo(true);
    try {
      const result = await sellerProfileService.deleteShopLogo(token);
      if (result.data) {
        setShopLogoUrl(null);
        setCompletion(result.data.profileCompletionPercentage);
        addToast('success', 'Shop logo removed');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { router.replace('/login'); return; }
      addToast('error', 'Failed to remove logo. Please try again.');
    } finally {
      setRemovingLogo(false);
    }
  };

  // --- Derived state ---
  const readonly = profile ? isReadOnly(profile.status) : false;
  const contentRestricted = profile ? isContentRestricted(profile.status) : false;
  const mediaRestricted = profile ? isMediaRestricted(profile.status) : false;

  // --- Render: Loading ---
  if (isLoading) {
    return (
      <div className="profile-page">
        <div className="profile-header">
          <div className="skeleton skeleton-line wide" />
          <div className="skeleton skeleton-line short" />
        </div>
        <div className="skeleton skeleton-input" />
        <div className="media-cards-row">
          <div className="profile-card" style={{ textAlign: 'center' }}>
            <div className="skeleton skeleton-circle" />
            <div className="skeleton skeleton-line medium" style={{ margin: '0 auto' }} />
          </div>
          <div className="profile-card" style={{ textAlign: 'center' }}>
            <div className="skeleton skeleton-rect" />
            <div className="skeleton skeleton-line medium" style={{ margin: '0 auto' }} />
          </div>
        </div>
        {[1, 2, 3, 4].map(i => (
          <div className="profile-card" key={i}>
            <div className="skeleton skeleton-line medium" />
            <div className="skeleton skeleton-input" />
            <div className="skeleton skeleton-input" />
          </div>
        ))}
      </div>
    );
  }

  // --- Render: Error ---
  if (fetchError) {
    return (
      <div className="profile-error-page">
        <h2>Unable to load profile</h2>
        <p>{fetchError}</p>
        <button className="btn-retry" onClick={fetchProfile}>
          Try Again
        </button>
      </div>
    );
  }

  if (!profile) return null;

  // --- Render: Main ---
  return (
    <div className="profile-page">
      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`toast toast-${t.type}`} role="alert">
              <span>{t.message}</span>
              <button className="toast-dismiss" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="profile-header">
        <div className="profile-header-top">
          <h1>My Profile</h1>
          <span className={getStatusBadgeClass(profile.status)}>
            {getStatusLabel(profile.status)}
          </span>
        </div>
        <p>Manage your seller account and store details</p>
      </div>

      {/* Status Banner */}
      {profile.status === 'SUSPENDED' && (
        <div className="status-banner banner-warning">
          Your account is suspended. Profile editing is disabled. Contact support for assistance.
        </div>
      )}
      {profile.status === 'DEACTIVATED' && (
        <div className="status-banner banner-error">
          Your account has been deactivated. Contact support for assistance.
        </div>
      )}
      {profile.status === 'INACTIVE' && (
        <div className="status-banner banner-info">
          Some features are limited while your account is inactive. You can update contact and address details.
        </div>
      )}
      {profile.status === 'PENDING_APPROVAL' && (
        <div className="status-banner banner-info">
          Your account is under review. You can still complete your profile.
        </div>
      )}

      {/* Email Verification Banner */}
      {!isEmailVerified && (
        <div className="email-verification-banner">
          <div className="email-verification-banner-content">
            <div className="email-verification-banner-icon">&#9993;</div>
            <div className="email-verification-banner-text">
              <strong>Email verification required</strong>
              <p>Please verify your email address ({profile.email}) to complete your profile setup.</p>
            </div>
          </div>
          <button
            type="button"
            className="btn-verify-email"
            onClick={handleSendVerificationOtp}
            disabled={sendingOtp || otpCooldown > 0}
          >
            {sendingOtp ? 'Sending...' : otpCooldown > 0 ? `Resend in ${otpCooldown}s` : 'Verify Email'}
          </button>
        </div>
      )}

      {/* OTP Verification Modal */}
      {showOtpModal && (
        <div className="otp-modal-overlay" onClick={() => setShowOtpModal(false)}>
          <div className="otp-modal" onClick={e => e.stopPropagation()}>
            <button className="otp-modal-close" onClick={() => setShowOtpModal(false)} aria-label="Close">&times;</button>
            <div className="otp-modal-header">
              <div className="otp-modal-icon">&#128231;</div>
              <h3>Verify your email</h3>
              <p>We&apos;ve sent a 6-digit code to <strong>{profile.email}</strong></p>
            </div>
            <div className="otp-input-group">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otpValue}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setOtpValue(val);
                  if (otpError) setOtpError(null);
                }}
                onKeyDown={e => { if (e.key === 'Enter') handleVerifyEmail(); }}
                placeholder="Enter 6-digit OTP"
                autoFocus
                className={otpError ? 'otp-input-error' : ''}
                aria-invalid={!!otpError}
                disabled={verifyingOtp}
              />
              {otpError && <span className="profile-field-error" role="alert">{otpError}</span>}
            </div>
            <button
              type="button"
              className="btn-save otp-verify-btn"
              onClick={handleVerifyEmail}
              disabled={verifyingOtp || otpValue.length !== 6}
            >
              {verifyingOtp ? 'Verifying...' : 'Verify'}
            </button>
            <div className="otp-modal-footer">
              <span>Didn&apos;t receive the code?</span>
              <button
                type="button"
                className="btn-resend-otp"
                onClick={handleSendVerificationOtp}
                disabled={sendingOtp || otpCooldown > 0}
              >
                {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : 'Resend OTP'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Verified Badge */}
      {isEmailVerified && (
        <div className="email-verified-badge">
          <span className="verified-icon">&#10003;</span>
          Email Verified
        </div>
      )}

      {/* Completion Bar */}
      <div className="completion-bar-wrapper">
        <div className="completion-bar-header">
          <span className="completion-bar-label">Profile Completion</span>
          <span className="completion-bar-value">{completion}%</span>
        </div>
        <div className="completion-bar-track" role="progressbar" aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100}>
          <div
            className={`completion-bar-fill${isComplete ? ' complete' : ''}`}
            style={{ width: `${completion}%` }}
          />
        </div>
      </div>

      {/* Media Cards */}
      <div className="media-cards-row">
        {/* Profile Image */}
        <div className="media-upload-card">
          <h3>Profile Image</h3>
          <div className="media-preview-container">
            <div className="media-preview-circle">
              {profileImageUrl ? (
                <img src={profileImageUrl} alt="Profile" />
              ) : (
                <span className="media-placeholder-icon">&#128100;</span>
              )}
            </div>
            {(uploadingImage || removingImage) && (
              <div className="media-upload-overlay">
                {uploadingImage ? 'Uploading...' : 'Removing...'}
              </div>
            )}
          </div>
          <div className="media-guidelines">
            JPG, PNG, or WEBP. Max 5MB.<br />Recommended: 400&times;400px
          </div>
          {mediaRestricted ? (
            <p className="media-unavailable">Upload available when account is active</p>
          ) : (
            <>
              <div className="media-actions">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleImageUpload(file);
                  }}
                  aria-label="Upload profile image"
                />
                <button
                  type="button"
                  className="btn-media btn-media-primary"
                  disabled={uploadingImage || removingImage}
                  onClick={() => imageInputRef.current?.click()}
                >
                  {profileImageUrl ? 'Replace' : 'Upload Image'}
                </button>
                {profileImageUrl && (
                  <button
                    type="button"
                    className="btn-media btn-media-danger"
                    disabled={uploadingImage || removingImage}
                    onClick={handleImageRemove}
                  >
                    Remove
                  </button>
                )}
              </div>
              {imageError && <p className="media-error">{imageError}</p>}
            </>
          )}
        </div>

        {/* Shop Logo */}
        <div className="media-upload-card">
          <h3>Shop Logo</h3>
          <div className="media-preview-container">
            <div className="media-preview-rect">
              {shopLogoUrl ? (
                <img src={shopLogoUrl} alt="Shop logo" />
              ) : (
                <span className="media-placeholder-icon">&#127978;</span>
              )}
            </div>
            {(uploadingLogo || removingLogo) && (
              <div className="media-upload-overlay">
                {uploadingLogo ? 'Uploading...' : 'Removing...'}
              </div>
            )}
          </div>
          <div className="media-guidelines">
            JPG, PNG, or WEBP. Max 5MB.<br />Recommended: 400&times;200px
          </div>
          {mediaRestricted ? (
            <p className="media-unavailable">Upload available when account is active</p>
          ) : (
            <>
              <div className="media-actions">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleLogoUpload(file);
                  }}
                  aria-label="Upload shop logo"
                />
                <button
                  type="button"
                  className="btn-media btn-media-primary"
                  disabled={uploadingLogo || removingLogo}
                  onClick={() => logoInputRef.current?.click()}
                >
                  {shopLogoUrl ? 'Replace' : 'Upload Logo'}
                </button>
                {shopLogoUrl && (
                  <button
                    type="button"
                    className="btn-media btn-media-danger"
                    disabled={uploadingLogo || removingLogo}
                    onClick={handleLogoRemove}
                  >
                    Remove
                  </button>
                )}
              </div>
              {logoError && <p className="media-error">{logoError}</p>}
            </>
          )}
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSave} noValidate>
        {/* Account Details */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h2>Account Details</h2>
            <p>Your identity and contact information</p>
          </div>

          {/* Email - read only */}
          <div className="form-grid-2">
            <div className="profile-form-group">
              <label>Email</label>
              <div className="readonly-field" aria-label="Email address (read-only)">
                <span className="lock-icon">&#128274;</span>
                {profile.email}
              </div>
            </div>
            <div className="profile-form-group">
              <label>Registered Phone</label>
              <div className="readonly-field" aria-label="Registered phone number (read-only)">
                <span className="lock-icon">&#128274;</span>
                {profile.phoneNumber}
              </div>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="profile-form-group">
              <label htmlFor="sellerName">Seller Name *</label>
              <input
                id="sellerName"
                type="text"
                value={formData.sellerName}
                onChange={e => updateField('sellerName', e.target.value)}
                onBlur={() => handleBlur('sellerName')}
                aria-invalid={!!errors.sellerName}
                aria-describedby={errors.sellerName ? 'sellerName-error' : undefined}
                disabled={readonly || isSaving}
                placeholder="Your name"
                autoComplete="name"
              />
              {errors.sellerName && (
                <span id="sellerName-error" className="profile-field-error" role="alert">
                  {errors.sellerName}
                </span>
              )}
            </div>
            <div className="profile-form-group">
              <label htmlFor="sellerShopName">Shop Name *</label>
              <input
                id="sellerShopName"
                type="text"
                value={formData.sellerShopName}
                onChange={e => updateField('sellerShopName', e.target.value)}
                onBlur={() => handleBlur('sellerShopName')}
                aria-invalid={!!errors.sellerShopName}
                aria-describedby={errors.sellerShopName ? 'sellerShopName-error' : undefined}
                disabled={readonly || isSaving}
                placeholder="Your shop name"
                autoComplete="organization"
              />
              {errors.sellerShopName && (
                <span id="sellerShopName-error" className="profile-field-error" role="alert">
                  {errors.sellerShopName}
                </span>
              )}
            </div>
          </div>

          {/* Phone */}
          <div className="profile-form-group">
            <label htmlFor="sellerContactNumber">Contact Number</label>
            <div className="phone-input-group">
              <select
                id="sellerContactCountryCode"
                value={formData.sellerContactCountryCode}
                onChange={e => updateField('sellerContactCountryCode', e.target.value)}
                onBlur={() => handleBlur('sellerContactCountryCode')}
                aria-invalid={!!errors.sellerContactCountryCode}
                disabled={readonly || isSaving}
                aria-label="Country code"
              >
                <option value="">Code</option>
                {COUNTRY_CODES.map(code => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
              <input
                id="sellerContactNumber"
                type="tel"
                inputMode="numeric"
                value={formData.sellerContactNumber}
                onChange={e => updateField('sellerContactNumber', e.target.value.replace(/\D/g, ''))}
                onBlur={() => handleBlur('sellerContactNumber')}
                aria-invalid={!!errors.sellerContactNumber}
                aria-describedby={
                  errors.sellerContactNumber ? 'phone-error' :
                  errors.phone ? 'phone-error' : undefined
                }
                disabled={readonly || isSaving}
                placeholder="Phone number"
                autoComplete="tel"
              />
            </div>
            {(errors.sellerContactCountryCode || errors.sellerContactNumber || errors.phone) && (
              <span id="phone-error" className="profile-field-error" role="alert">
                {errors.sellerContactCountryCode || errors.sellerContactNumber || errors.phone}
              </span>
            )}
          </div>
        </div>

        {/* Store Address */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h2>Store Address</h2>
            <p>Your physical store or warehouse address</p>
          </div>

          <div className="profile-form-group">
            <label htmlFor="storeAddress">Address</label>
            <textarea
              id="storeAddress"
              rows={3}
              value={formData.storeAddress}
              onChange={e => updateField('storeAddress', e.target.value)}
              onBlur={() => handleBlur('storeAddress')}
              aria-invalid={!!errors.storeAddress}
              aria-describedby={errors.storeAddress ? 'storeAddress-error' : undefined}
              disabled={readonly || isSaving}
              placeholder="Street address, building, landmark"
              autoComplete="street-address"
            />
            {errors.storeAddress && (
              <span id="storeAddress-error" className="profile-field-error" role="alert">
                {errors.storeAddress}
              </span>
            )}
          </div>

          <div className="form-grid-2">
            <div className="profile-form-group">
              <label htmlFor="sellerZipCode">ZIP / PIN Code</label>
              <input
                id="sellerZipCode"
                type="text"
                value={formData.sellerZipCode}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                  updateField('sellerZipCode', val);
                  lookupPincode(val);
                }}
                onBlur={() => handleBlur('sellerZipCode')}
                aria-invalid={!!errors.sellerZipCode}
                aria-describedby={errors.sellerZipCode ? 'zip-error' : undefined}
                disabled={readonly || isSaving}
                placeholder="ZIP / PIN code"
                autoComplete="postal-code"
                maxLength={6}
              />
              {pincodeLoading && (
                <span className="profile-field-hint" style={{ color: '#6b7280', fontSize: 12 }}>Looking up pincode...</span>
              )}
              {pincodeError && (
                <span className="profile-field-error" role="alert" style={{ color: '#dc2626' }}>{pincodeError}</span>
              )}
              {pincodeData && !pincodeError && !pincodeLoading && (
                <span style={{ color: '#16a34a', fontSize: 12 }}>{pincodeData.district}, {pincodeData.state}</span>
              )}
              {errors.sellerZipCode && (
                <span id="zip-error" className="profile-field-error" role="alert">
                  {errors.sellerZipCode}
                </span>
              )}
            </div>
            <div className="profile-form-group">
              <label htmlFor="country">Country</label>
              <input
                id="country"
                type="text"
                value={formData.country}
                onChange={e => updateField('country', e.target.value)}
                onBlur={() => handleBlur('country')}
                aria-invalid={!!errors.country}
                aria-describedby={errors.country ? 'country-error' : undefined}
                disabled={readonly || isSaving}
                placeholder="Country"
                autoComplete="country-name"
              />
              {errors.country && (
                <span id="country-error" className="profile-field-error" role="alert">
                  {errors.country}
                </span>
              )}
            </div>
          </div>

          <div className="form-grid-2">
            <div className="profile-form-group">
              <label htmlFor="city">City / District</label>
              <input
                id="city"
                type="text"
                value={formData.city}
                onChange={e => {
                  updateField('city', e.target.value);
                  if (pincodeAutoFilled) setPincodeAutoFilled(false);
                }}
                onBlur={() => handleBlur('city')}
                aria-invalid={!!errors.city}
                aria-describedby={errors.city ? 'city-error' : undefined}
                disabled={readonly || isSaving}
                readOnly={pincodeAutoFilled}
                placeholder="City"
                autoComplete="address-level2"
                style={pincodeAutoFilled ? { background: '#f0fdf4', borderColor: '#86efac' } : undefined}
              />
              {errors.city && (
                <span id="city-error" className="profile-field-error" role="alert">
                  {errors.city}
                </span>
              )}
            </div>
            <div className="profile-form-group">
              <label htmlFor="state">State</label>
              <input
                id="state"
                type="text"
                value={formData.state}
                onChange={e => {
                  updateField('state', e.target.value);
                  if (pincodeAutoFilled) setPincodeAutoFilled(false);
                }}
                onBlur={() => handleBlur('state')}
                aria-invalid={!!errors.state}
                aria-describedby={errors.state ? 'state-error' : undefined}
                disabled={readonly || isSaving}
                placeholder="State / Province"
                autoComplete="address-level1"
                style={pincodeAutoFilled ? { background: '#f0fdf4', borderColor: '#86efac' } : undefined}
              />
              {errors.state && (
                <span id="state-error" className="profile-field-error" role="alert">
                  {errors.state}
                </span>
              )}
            </div>
          </div>

          {pincodeData && pincodeData.places && pincodeData.places.length > 0 && (
            <div className="profile-form-group">
              <label htmlFor="locality">Locality</label>
              <select
                id="locality"
                value={formData.locality || selectedPlace}
                onChange={e => { setSelectedPlace(e.target.value); updateField('locality', e.target.value); }}
                disabled={readonly || isSaving}
                style={pincodeAutoFilled ? { background: '#f0fdf4', borderColor: '#86efac' } : undefined}
              >
                <option value="">Select your locality</option>
                {pincodeData.places.map((place, idx) => (
                  <option key={idx} value={place.name}>{place.name}</option>
                ))}
              </select>
            </div>
          )}
          {!pincodeData && formData.locality && (
            <div className="profile-form-group">
              <label htmlFor="locality">Locality</label>
              <input
                id="locality"
                type="text"
                value={formData.locality}
                readOnly
                style={{ background: '#f9fafb' }}
              />
            </div>
          )}
        </div>

        {/* Store Description */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h2>Store Description</h2>
            <p>Tell customers about your store</p>
          </div>

          <div className="profile-form-group">
            <label htmlFor="shortStoreDescription">Short Description</label>
            {contentRestricted || readonly ? (
              <div className="editor-wrapper editor-disabled">
                <div
                  className="ql-editor"
                  dangerouslySetInnerHTML={{ __html: formData.shortStoreDescription || '<p style="color: var(--color-text-secondary)">No description yet</p>' }}
                />
              </div>
            ) : (
              <>
                <div
                  className={`editor-wrapper${errors.shortStoreDescription ? '' : ''}`}
                  data-invalid={!!errors.shortStoreDescription}
                >
                  <ReactQuill
                    theme="snow"
                    value={formData.shortStoreDescription}
                    onChange={val => updateField('shortStoreDescription', val)}
                    modules={QUILL_MODULES}
                    formats={QUILL_FORMATS}
                    placeholder="Brief description of your store (max 500 characters)"
                    readOnly={isSaving}
                  />
                </div>
                <div className={`editor-char-count${
                  getPlainTextLength(formData.shortStoreDescription) > 500 ? ' char-error' :
                  getPlainTextLength(formData.shortStoreDescription) > 450 ? ' char-warning' : ''
                }`}>
                  {getPlainTextLength(formData.shortStoreDescription)} / 500
                </div>
              </>
            )}
            {errors.shortStoreDescription && (
              <span className="profile-field-error" role="alert">
                {errors.shortStoreDescription}
              </span>
            )}
          </div>

          <div className="profile-form-group">
            <label htmlFor="detailedStoreDescription">Detailed Description</label>
            {contentRestricted || readonly ? (
              <div className="editor-wrapper editor-disabled">
                <div
                  className="ql-editor"
                  dangerouslySetInnerHTML={{ __html: formData.detailedStoreDescription || '<p style="color: var(--color-text-secondary)">No description yet</p>' }}
                />
              </div>
            ) : (
              <>
                <div
                  className="editor-wrapper editor-tall"
                  data-invalid={!!errors.detailedStoreDescription}
                >
                  <ReactQuill
                    theme="snow"
                    value={formData.detailedStoreDescription}
                    onChange={val => updateField('detailedStoreDescription', val)}
                    modules={QUILL_MODULES}
                    formats={QUILL_FORMATS}
                    placeholder="Detailed description of your store, products, and services"
                    readOnly={isSaving}
                  />
                </div>
                <div className={`editor-char-count${
                  getPlainTextLength(formData.detailedStoreDescription) > 10000 ? ' char-error' :
                  getPlainTextLength(formData.detailedStoreDescription) > 9500 ? ' char-warning' : ''
                }`}>
                  {getPlainTextLength(formData.detailedStoreDescription)} / 10,000
                </div>
              </>
            )}
            {errors.detailedStoreDescription && (
              <span className="profile-field-error" role="alert">
                {errors.detailedStoreDescription}
              </span>
            )}
          </div>

          {(contentRestricted) && (
            <p className="media-unavailable">Content editing is available when your account is active</p>
          )}
        </div>

        {/* Seller Policy */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h2>Seller Policy</h2>
            <p>Describe your return, refund, shipping, and exchange policies</p>
          </div>

          <div className="profile-form-group">
            <label htmlFor="sellerPolicy">Policy Content</label>
            {contentRestricted || readonly ? (
              <div className="editor-wrapper editor-disabled">
                <div
                  className="ql-editor"
                  dangerouslySetInnerHTML={{ __html: formData.sellerPolicy || '<p style="color: var(--color-text-secondary)">No policy defined yet</p>' }}
                />
              </div>
            ) : (
              <>
                <div
                  className="editor-wrapper editor-tall"
                  data-invalid={!!errors.sellerPolicy}
                >
                  <ReactQuill
                    theme="snow"
                    value={formData.sellerPolicy}
                    onChange={val => updateField('sellerPolicy', val)}
                    modules={QUILL_MODULES}
                    formats={QUILL_FORMATS}
                    placeholder="Your store policies — returns, refunds, shipping, exchanges"
                    readOnly={isSaving}
                  />
                </div>
                <div className={`editor-char-count${
                  getPlainTextLength(formData.sellerPolicy) > 10000 ? ' char-error' :
                  getPlainTextLength(formData.sellerPolicy) > 9500 ? ' char-warning' : ''
                }`}>
                  {getPlainTextLength(formData.sellerPolicy)} / 10,000
                </div>
              </>
            )}
            {errors.sellerPolicy && (
              <span className="profile-field-error" role="alert">
                {errors.sellerPolicy}
              </span>
            )}
          </div>
        </div>

        {/* Save Footer */}
        {!readonly && (
          <div className="save-footer">
            <button
              type="submit"
              className={`btn-save${saveSuccess ? ' save-success' : ''}`}
              disabled={!isDirty || isSaving}
              aria-busy={isSaving}
              aria-disabled={!isDirty || isSaving}
            >
              {isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Changes'}
            </button>
          </div>
        )}
      </form>

      {/* Security - Change Password */}
      <div className="profile-card" style={{ marginTop: 24 }}>
        <div className="profile-card-header">
          <h2>Security</h2>
          <p>Manage your account password</p>
        </div>
        <div className="security-password-row">
          <div className="security-password-info">
            <span className="security-lock-icon">&#128274;</span>
            <div>
              <div className="security-password-label">Password</div>
              <div className="security-password-hint">Keep your account secure by using a strong password</div>
            </div>
          </div>
          <button
            type="button"
            className="btn-change-password"
            onClick={openPasswordModal}
          >
            Change Password
          </button>
        </div>
      </div>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="pw-modal-overlay" onClick={() => !pwSubmitting && setShowPasswordModal(false)}>
          <div className="pw-modal" onClick={e => e.stopPropagation()}>
            <div className="pw-modal-header">
              <h2>Change Password</h2>
              <button
                className="pw-modal-close"
                onClick={() => !pwSubmitting && setShowPasswordModal(false)}
                disabled={pwSubmitting}
              >&times;</button>
            </div>
            <div className="pw-modal-body">
              {pwError && <div className="pw-modal-alert">{pwError}</div>}

              <div className="pw-form-group">
                <label htmlFor="pwCurrent">Current Password</label>
                <div className="pw-input-wrapper">
                  <input
                    id="pwCurrent"
                    type={showCurrentPw ? 'text' : 'password'}
                    value={pwCurrentPassword}
                    onChange={e => {
                      setPwCurrentPassword(e.target.value);
                      if (pwFieldErrors.currentPassword) setPwFieldErrors(prev => { const n = { ...prev }; delete n.currentPassword; return n; });
                    }}
                    disabled={pwSubmitting}
                    placeholder="Enter current password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="pw-toggle-btn"
                    onClick={() => setShowCurrentPw(!showCurrentPw)}
                    tabIndex={-1}
                  >{showCurrentPw ? 'Hide' : 'Show'}</button>
                </div>
                {pwFieldErrors.currentPassword && <span className="profile-field-error">{pwFieldErrors.currentPassword}</span>}
              </div>

              <div className="pw-form-group">
                <label htmlFor="pwNew">New Password</label>
                <div className="pw-input-wrapper">
                  <input
                    id="pwNew"
                    type={showNewPw ? 'text' : 'password'}
                    value={pwNewPassword}
                    onChange={e => {
                      setPwNewPassword(e.target.value);
                      if (pwFieldErrors.newPassword) setPwFieldErrors(prev => { const n = { ...prev }; delete n.newPassword; return n; });
                    }}
                    disabled={pwSubmitting}
                    placeholder="Enter new password"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="pw-toggle-btn"
                    onClick={() => setShowNewPw(!showNewPw)}
                    tabIndex={-1}
                  >{showNewPw ? 'Hide' : 'Show'}</button>
                </div>
                {pwFieldErrors.newPassword && <span className="profile-field-error">{pwFieldErrors.newPassword}</span>}
                {/* Password strength indicators */}
                {pwNewPassword && (
                  <div className="pw-strength-checks">
                    <div className={`pw-check${pwNewPassword.length >= 8 ? ' pw-check-pass' : ''}`}>
                      {pwNewPassword.length >= 8 ? '\u2713' : '\u2717'} At least 8 characters
                    </div>
                    <div className={`pw-check${/[a-z]/.test(pwNewPassword) ? ' pw-check-pass' : ''}`}>
                      {/[a-z]/.test(pwNewPassword) ? '\u2713' : '\u2717'} Lowercase letter
                    </div>
                    <div className={`pw-check${/[A-Z]/.test(pwNewPassword) ? ' pw-check-pass' : ''}`}>
                      {/[A-Z]/.test(pwNewPassword) ? '\u2713' : '\u2717'} Uppercase letter
                    </div>
                    <div className={`pw-check${/\d/.test(pwNewPassword) ? ' pw-check-pass' : ''}`}>
                      {/\d/.test(pwNewPassword) ? '\u2713' : '\u2717'} Number
                    </div>
                    <div className={`pw-check${/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwNewPassword) ? ' pw-check-pass' : ''}`}>
                      {/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwNewPassword) ? '\u2713' : '\u2717'} Special character
                    </div>
                  </div>
                )}
              </div>

              <div className="pw-form-group">
                <label htmlFor="pwConfirm">Confirm New Password</label>
                <div className="pw-input-wrapper">
                  <input
                    id="pwConfirm"
                    type={showConfirmPw ? 'text' : 'password'}
                    value={pwConfirmPassword}
                    onChange={e => {
                      setPwConfirmPassword(e.target.value);
                      if (pwFieldErrors.confirmPassword) setPwFieldErrors(prev => { const n = { ...prev }; delete n.confirmPassword; return n; });
                    }}
                    disabled={pwSubmitting}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="pw-toggle-btn"
                    onClick={() => setShowConfirmPw(!showConfirmPw)}
                    tabIndex={-1}
                  >{showConfirmPw ? 'Hide' : 'Show'}</button>
                </div>
                {pwFieldErrors.confirmPassword && <span className="profile-field-error">{pwFieldErrors.confirmPassword}</span>}
              </div>
            </div>
            <div className="pw-modal-footer">
              <button
                type="button"
                className="pw-btn pw-btn-cancel"
                onClick={() => setShowPasswordModal(false)}
                disabled={pwSubmitting}
              >Cancel</button>
              <button
                type="button"
                className="pw-btn pw-btn-submit"
                onClick={handleChangePassword}
                disabled={pwSubmitting}
              >
                {pwSubmitting ? 'Changing...' : 'Change Password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
