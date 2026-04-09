interface SellerProfileFields {
  sellerName: string | null;
  sellerShopName: string | null;
  sellerContactCountryCode: string | null;
  sellerContactNumber: string | null;
  storeAddress: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  sellerZipCode: string | null;
  shortStoreDescription: string | null;
  detailedStoreDescription: string | null;
  sellerPolicy: string | null;
  sellerProfileImageUrl: string | null;
  sellerShopLogoUrl: string | null;
}

export function computeProfileCompletion(seller: SellerProfileFields): {
  profileCompletionPercentage: number;
  isProfileCompleted: boolean;
} {
  let percentage = 0;

  // Identity (15%) — sellerName + sellerShopName
  if (seller.sellerName && seller.sellerShopName) {
    percentage += 15;
  }

  // Contact (10%) — countryCode + contactNumber
  if (seller.sellerContactCountryCode && seller.sellerContactNumber) {
    percentage += 10;
  }

  // Address (25%) — all 5 fields
  if (
    seller.storeAddress &&
    seller.city &&
    seller.state &&
    seller.country &&
    seller.sellerZipCode
  ) {
    percentage += 25;
  }

  // Short description (10%)
  if (seller.shortStoreDescription) {
    percentage += 10;
  }

  // Detailed description (15%)
  if (seller.detailedStoreDescription) {
    percentage += 15;
  }

  // Policy (10%)
  if (seller.sellerPolicy) {
    percentage += 10;
  }

  // Profile image (10%)
  if (seller.sellerProfileImageUrl) {
    percentage += 10;
  }

  // Shop logo (5%)
  if (seller.sellerShopLogoUrl) {
    percentage += 5;
  }

  return {
    profileCompletionPercentage: percentage,
    isProfileCompleted: percentage === 100,
  };
}
