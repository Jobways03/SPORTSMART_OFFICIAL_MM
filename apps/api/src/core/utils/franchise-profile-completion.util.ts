interface FranchiseProfileFields {
  ownerName: string | null;
  businessName: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  pincode: string | null;
  gstNumber: string | null;
  panNumber: string | null;
  warehouseAddress: string | null;
  warehousePincode: string | null;
  profileImageUrl: string | null;
  logoUrl: string | null;
}

export function computeFranchiseProfileCompletion(franchise: FranchiseProfileFields): {
  profileCompletionPercentage: number;
  isProfileCompleted: boolean;
} {
  let percentage = 0;

  // Identity (20%) — ownerName + businessName
  if (franchise.ownerName && franchise.businessName) {
    percentage += 20;
  }

  // Address (25%) — state + city + address + pincode
  if (franchise.state && franchise.city && franchise.address && franchise.pincode) {
    percentage += 25;
  }

  // Tax documents (20%) — GST + PAN
  if (franchise.gstNumber && franchise.panNumber) {
    percentage += 20;
  }

  // Warehouse (20%) — warehouseAddress + warehousePincode
  if (franchise.warehouseAddress && franchise.warehousePincode) {
    percentage += 20;
  }

  // Branding (15%) — profileImage (10%) + logo (5%)
  if (franchise.profileImageUrl) {
    percentage += 10;
  }
  if (franchise.logoUrl) {
    percentage += 5;
  }

  return {
    profileCompletionPercentage: percentage,
    isProfileCompleted: percentage === 100,
  };
}
