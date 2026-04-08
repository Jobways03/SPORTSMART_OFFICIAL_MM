/**
 * Seed Script: Shopify-style Category Metafield Definitions
 *
 * Run with: npx ts-node prisma/seed-metafields.ts
 *
 * This creates standardized product attributes for every sports category,
 * following Shopify's taxonomy pattern where:
 *   - Parent categories define common attributes inherited by all children
 *   - Child categories add sport/product-specific attributes
 *   - Attributes use the "taxonomy" namespace (standard)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// ATTRIBUTE DEFINITIONS BY CATEGORY SLUG
// ─────────────────────────────────────────────────────────────────────────────

interface AttrDef {
  key: string;
  name: string;
  description?: string;
  type: string;
  choices?: Array<{ value: string; label: string }>;
  isRequired?: boolean;
  sortOrder?: number;
}

const CATEGORY_ATTRIBUTES: Record<string, AttrDef[]> = {

  // ═══════════════════════════════════════════════════════════════════════════
  // TOP-LEVEL: APPAREL (inherited by T-Shirts, Shorts, Track Pants, Jerseys, Jackets)
  // ═══════════════════════════════════════════════════════════════════════════
  'apparel': [
    {
      key: 'target_gender', name: 'Target Gender', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 1,
      description: 'Who this product is designed for',
      choices: [
        { value: 'men', label: 'Men' },
        { value: 'women', label: 'Women' },
        { value: 'unisex', label: 'Unisex' },
        { value: 'boys', label: 'Boys' },
        { value: 'girls', label: 'Girls' },
      ],
    },
    {
      key: 'age_group', name: 'Age Group', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 2,
      description: 'Target age group',
      choices: [
        { value: 'adult', label: 'Adult' },
        { value: 'youth', label: 'Youth (13-17)' },
        { value: 'kids', label: 'Kids (5-12)' },
        { value: 'toddler', label: 'Toddler (2-4)' },
        { value: 'infant', label: 'Infant (0-2)' },
      ],
    },
    {
      key: 'material', name: 'Material', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 3,
      description: 'Primary fabric or material',
      choices: [
        { value: 'cotton', label: 'Cotton' },
        { value: 'polyester', label: 'Polyester' },
        { value: 'nylon', label: 'Nylon' },
        { value: 'spandex', label: 'Spandex / Elastane' },
        { value: 'cotton_polyester', label: 'Cotton-Polyester Blend' },
        { value: 'drifit', label: 'Dri-FIT / Moisture Wicking' },
        { value: 'mesh', label: 'Mesh' },
        { value: 'fleece', label: 'Fleece' },
        { value: 'wool', label: 'Wool / Merino' },
        { value: 'bamboo', label: 'Bamboo Fabric' },
      ],
    },
    {
      key: 'fit_type', name: 'Fit Type', type: 'SINGLE_SELECT', sortOrder: 4,
      description: 'Garment fit style',
      choices: [
        { value: 'regular', label: 'Regular Fit' },
        { value: 'slim', label: 'Slim Fit' },
        { value: 'loose', label: 'Loose / Relaxed Fit' },
        { value: 'compression', label: 'Compression Fit' },
        { value: 'athletic', label: 'Athletic Fit' },
      ],
    },
    {
      key: 'pattern', name: 'Pattern', type: 'SINGLE_SELECT', sortOrder: 5,
      choices: [
        { value: 'solid', label: 'Solid' },
        { value: 'striped', label: 'Striped' },
        { value: 'printed', label: 'Printed' },
        { value: 'colorblock', label: 'Color Block' },
        { value: 'camo', label: 'Camouflage' },
        { value: 'geometric', label: 'Geometric' },
        { value: 'gradient', label: 'Gradient / Ombre' },
      ],
    },
    {
      key: 'care_instructions', name: 'Care Instructions', type: 'MULTI_SELECT', sortOrder: 6,
      description: 'Washing and care instructions',
      choices: [
        { value: 'machine_wash_cold', label: 'Machine wash cold' },
        { value: 'machine_wash_warm', label: 'Machine wash warm' },
        { value: 'hand_wash', label: 'Hand wash only' },
        { value: 'tumble_dry_low', label: 'Tumble dry low' },
        { value: 'hang_dry', label: 'Hang dry' },
        { value: 'do_not_bleach', label: 'Do not bleach' },
        { value: 'do_not_iron', label: 'Do not iron' },
        { value: 'iron_low', label: 'Iron on low heat' },
        { value: 'dry_clean', label: 'Dry clean only' },
      ],
    },
    {
      key: 'sport', name: 'Sport', type: 'MULTI_SELECT', sortOrder: 7,
      description: 'Sports this apparel is designed for',
      choices: [
        { value: 'cricket', label: 'Cricket' },
        { value: 'football', label: 'Football' },
        { value: 'badminton', label: 'Badminton' },
        { value: 'running', label: 'Running' },
        { value: 'gym', label: 'Gym / Training' },
        { value: 'yoga', label: 'Yoga' },
        { value: 'tennis', label: 'Tennis' },
        { value: 'basketball', label: 'Basketball' },
        { value: 'swimming', label: 'Swimming' },
        { value: 'hiking', label: 'Hiking / Outdoor' },
        { value: 'general', label: 'General / Multi-sport' },
      ],
    },
    {
      key: 'season', name: 'Season', type: 'MULTI_SELECT', sortOrder: 8,
      choices: [
        { value: 'summer', label: 'Summer' },
        { value: 'winter', label: 'Winter' },
        { value: 'monsoon', label: 'Monsoon / Rainy' },
        { value: 'all_season', label: 'All Season' },
      ],
    },
    {
      key: 'uv_protection', name: 'UV Protection', type: 'BOOLEAN', sortOrder: 9,
      description: 'Does this product offer UV/sun protection?',
    },
    {
      key: 'moisture_wicking', name: 'Moisture Wicking', type: 'BOOLEAN', sortOrder: 10,
      description: 'Does this fabric wick away sweat?',
    },
  ],

  // ─── T-Shirts (child of Apparel — inherits all above, adds specific) ────
  't-shirts': [
    {
      key: 'sleeve_length', name: 'Sleeve Length', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 20,
      choices: [
        { value: 'sleeveless', label: 'Sleeveless' },
        { value: 'short', label: 'Short Sleeve' },
        { value: 'three_quarter', label: '3/4 Sleeve' },
        { value: 'long', label: 'Long Sleeve' },
      ],
    },
    {
      key: 'neckline', name: 'Neckline', type: 'SINGLE_SELECT', sortOrder: 21,
      choices: [
        { value: 'round', label: 'Round / Crew Neck' },
        { value: 'vneck', label: 'V-Neck' },
        { value: 'polo', label: 'Polo / Collar' },
        { value: 'henley', label: 'Henley' },
        { value: 'mock', label: 'Mock Neck' },
      ],
    },
  ],

  // ─── Shorts ─────────────────────────────────────────────────────────────
  'shorts': [
    {
      key: 'length_style', name: 'Length', type: 'SINGLE_SELECT', sortOrder: 20,
      choices: [
        { value: 'above_knee', label: 'Above Knee (5-7 inch)' },
        { value: 'knee_length', label: 'Knee Length (8-9 inch)' },
        { value: 'three_quarter', label: '3/4 Length' },
      ],
    },
    {
      key: 'has_pockets', name: 'Has Pockets', type: 'BOOLEAN', sortOrder: 21 },
    {
      key: 'has_liner', name: 'Built-in Liner', type: 'BOOLEAN', sortOrder: 22,
      description: 'Does this short have a built-in brief/compression liner?',
    },
    {
      key: 'waistband_type', name: 'Waistband Type', type: 'SINGLE_SELECT', sortOrder: 23,
      choices: [
        { value: 'elastic', label: 'Elastic Waistband' },
        { value: 'drawstring', label: 'Drawstring' },
        { value: 'button', label: 'Button / Zip' },
        { value: 'elastic_drawstring', label: 'Elastic + Drawstring' },
      ],
    },
  ],

  // ─── Track Pants ────────────────────────────────────────────────────────
  'track-pants': [
    {
      key: 'leg_style', name: 'Leg Style', type: 'SINGLE_SELECT', sortOrder: 20,
      choices: [
        { value: 'straight', label: 'Straight Leg' },
        { value: 'tapered', label: 'Tapered / Jogger' },
        { value: 'wide', label: 'Wide Leg' },
        { value: 'bootcut', label: 'Bootcut' },
      ],
    },
    {
      key: 'has_zip_pockets', name: 'Zip Pockets', type: 'BOOLEAN', sortOrder: 21 },
    {
      key: 'ankle_style', name: 'Ankle Style', type: 'SINGLE_SELECT', sortOrder: 22,
      choices: [
        { value: 'open', label: 'Open Hem' },
        { value: 'cuffed', label: 'Cuffed / Ribbed' },
        { value: 'zippered', label: 'Zippered Ankle' },
      ],
    },
  ],

  // ─── Jerseys ────────────────────────────────────────────────────────────
  'jerseys': [
    {
      key: 'jersey_type', name: 'Jersey Type', type: 'SINGLE_SELECT', sortOrder: 20,
      choices: [
        { value: 'match', label: 'Match / Game Day' },
        { value: 'training', label: 'Training' },
        { value: 'fan', label: 'Fan Replica' },
        { value: 'retro', label: 'Retro / Classic' },
      ],
    },
    {
      key: 'team_sport', name: 'Team Sport', type: 'SINGLE_SELECT', sortOrder: 21,
      choices: [
        { value: 'cricket', label: 'Cricket' },
        { value: 'football', label: 'Football' },
        { value: 'basketball', label: 'Basketball' },
        { value: 'hockey', label: 'Hockey' },
        { value: 'kabaddi', label: 'Kabaddi' },
        { value: 'badminton', label: 'Badminton' },
      ],
    },
    {
      key: 'customizable', name: 'Customizable (Name/Number)', type: 'BOOLEAN', sortOrder: 22 },
  ],

  // ─── Jackets ────────────────────────────────────────────────────────────
  'jackets': [
    {
      key: 'jacket_type', name: 'Jacket Type', type: 'SINGLE_SELECT', sortOrder: 20,
      choices: [
        { value: 'windbreaker', label: 'Windbreaker' },
        { value: 'rain_jacket', label: 'Rain Jacket' },
        { value: 'track_jacket', label: 'Track Jacket' },
        { value: 'hoodie', label: 'Hoodie / Sweatshirt' },
        { value: 'vest', label: 'Vest / Gilet' },
        { value: 'puffer', label: 'Puffer / Insulated' },
        { value: 'softshell', label: 'Softshell' },
      ],
    },
    {
      key: 'waterproof', name: 'Waterproof', type: 'BOOLEAN', sortOrder: 21 },
    {
      key: 'windproof', name: 'Windproof', type: 'BOOLEAN', sortOrder: 22 },
    {
      key: 'has_hood', name: 'Has Hood', type: 'BOOLEAN', sortOrder: 23 },
    {
      key: 'insulation_type', name: 'Insulation Type', type: 'SINGLE_SELECT', sortOrder: 24,
      choices: [
        { value: 'none', label: 'None (Shell only)' },
        { value: 'fleece', label: 'Fleece Lined' },
        { value: 'synthetic', label: 'Synthetic Fill' },
        { value: 'down', label: 'Down Fill' },
      ],
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // TOP-LEVEL: FOOTWEAR (inherited by all shoe categories)
  // ═══════════════════════════════════════════════════════════════════════════
  'footwear': [
    {
      key: 'target_gender', name: 'Target Gender', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 1,
      choices: [
        { value: 'men', label: 'Men' },
        { value: 'women', label: 'Women' },
        { value: 'unisex', label: 'Unisex' },
        { value: 'boys', label: 'Boys' },
        { value: 'girls', label: 'Girls' },
      ],
    },
    {
      key: 'age_group', name: 'Age Group', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 2,
      choices: [
        { value: 'adult', label: 'Adult' },
        { value: 'youth', label: 'Youth' },
        { value: 'kids', label: 'Kids' },
      ],
    },
    {
      key: 'upper_material', name: 'Upper Material', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 3,
      choices: [
        { value: 'leather', label: 'Leather' },
        { value: 'synthetic_leather', label: 'Synthetic Leather' },
        { value: 'mesh', label: 'Mesh / Knit' },
        { value: 'canvas', label: 'Canvas' },
        { value: 'rubber', label: 'Rubber' },
        { value: 'textile', label: 'Textile' },
        { value: 'flyknit', label: 'Flyknit / Engineered Knit' },
      ],
    },
    {
      key: 'sole_material', name: 'Sole Material', type: 'SINGLE_SELECT', sortOrder: 4,
      choices: [
        { value: 'rubber', label: 'Rubber' },
        { value: 'eva', label: 'EVA Foam' },
        { value: 'phylon', label: 'Phylon' },
        { value: 'tpu', label: 'TPU' },
        { value: 'pu', label: 'Polyurethane (PU)' },
        { value: 'gum_rubber', label: 'Gum Rubber (Non-marking)' },
      ],
    },
    {
      key: 'closure_type', name: 'Closure Type', type: 'SINGLE_SELECT', sortOrder: 5,
      choices: [
        { value: 'lace_up', label: 'Lace-Up' },
        { value: 'velcro', label: 'Velcro / Hook & Loop' },
        { value: 'slip_on', label: 'Slip-On' },
        { value: 'boa', label: 'BOA Dial' },
        { value: 'buckle', label: 'Buckle' },
        { value: 'zip', label: 'Zip' },
      ],
    },
    {
      key: 'arch_support', name: 'Arch Support', type: 'SINGLE_SELECT', sortOrder: 6,
      choices: [
        { value: 'neutral', label: 'Neutral' },
        { value: 'stability', label: 'Stability' },
        { value: 'motion_control', label: 'Motion Control' },
        { value: 'minimal', label: 'Minimal / Barefoot' },
      ],
    },
    {
      key: 'waterproof', name: 'Waterproof', type: 'BOOLEAN', sortOrder: 7 },
    {
      key: 'ankle_height', name: 'Ankle Height', type: 'SINGLE_SELECT', sortOrder: 8,
      choices: [
        { value: 'low', label: 'Low-Top' },
        { value: 'mid', label: 'Mid-Top' },
        { value: 'high', label: 'High-Top' },
      ],
    },
    {
      key: 'cushioning', name: 'Cushioning Level', type: 'SINGLE_SELECT', sortOrder: 9,
      choices: [
        { value: 'minimal', label: 'Minimal' },
        { value: 'moderate', label: 'Moderate' },
        { value: 'maximum', label: 'Maximum' },
        { value: 'plush', label: 'Plush / Ultra Cushioned' },
      ],
    },
  ],

  // ─── Running Shoes ──────────────────────────────────────────────────────
  'running-shoes': [
    {
      key: 'pronation', name: 'Pronation Type', type: 'SINGLE_SELECT', sortOrder: 20,
      description: 'Gait/pronation style this shoe supports',
      choices: [
        { value: 'neutral', label: 'Neutral' },
        { value: 'overpronation', label: 'Overpronation (Stability)' },
        { value: 'underpronation', label: 'Underpronation (Supination)' },
      ],
    },
    {
      key: 'drop_mm', name: 'Heel-to-Toe Drop (mm)', type: 'NUMBER_INTEGER', sortOrder: 21,
      description: 'Difference in height between heel and toe in millimeters',
    },
    {
      key: 'terrain', name: 'Terrain', type: 'SINGLE_SELECT', sortOrder: 22,
      choices: [
        { value: 'road', label: 'Road' },
        { value: 'trail', label: 'Trail' },
        { value: 'track', label: 'Track' },
        { value: 'treadmill', label: 'Treadmill' },
        { value: 'all_terrain', label: 'All Terrain' },
      ],
    },
    {
      key: 'carbon_plate', name: 'Carbon Plate', type: 'BOOLEAN', sortOrder: 23,
      description: 'Does this shoe have a carbon fiber plate for energy return?',
    },
    {
      key: 'reflective', name: 'Reflective Elements', type: 'BOOLEAN', sortOrder: 24,
      description: 'Has reflective details for low-light visibility',
    },
  ],

  // ─── Road Running / Trail Running (level 2 — inherit from running-shoes) ─
  'road-running': [
    {
      key: 'race_type', name: 'Race Type', type: 'SINGLE_SELECT', sortOrder: 30,
      choices: [
        { value: 'daily_trainer', label: 'Daily Trainer' },
        { value: 'tempo', label: 'Tempo / Speed' },
        { value: 'marathon', label: 'Marathon Racer' },
        { value: 'recovery', label: 'Recovery / Easy' },
      ],
    },
  ],
  'trail-running': [
    {
      key: 'lug_depth', name: 'Lug Depth', type: 'SINGLE_SELECT', sortOrder: 30,
      description: 'Outsole tread depth for grip',
      choices: [
        { value: 'shallow', label: 'Shallow (2-3mm, light trail)' },
        { value: 'medium', label: 'Medium (4-5mm, mixed terrain)' },
        { value: 'deep', label: 'Deep (6mm+, technical/muddy)' },
      ],
    },
    {
      key: 'rock_plate', name: 'Rock Plate', type: 'BOOLEAN', sortOrder: 31,
      description: 'Protective plate under the forefoot for rocky terrain',
    },
  ],

  // ─── Cricket Shoes ──────────────────────────────────────────────────────
  'cricket-shoes': [
    {
      key: 'cricket_shoe_type', name: 'Shoe Type', type: 'SINGLE_SELECT', sortOrder: 20,
      choices: [
        { value: 'batting', label: 'Batting Shoes' },
        { value: 'bowling', label: 'Bowling Shoes' },
        { value: 'all_rounder', label: 'All-Rounder' },
      ],
    },
    {
      key: 'stud_type', name: 'Stud Type', type: 'SINGLE_SELECT', sortOrder: 21,
      choices: [
        { value: 'rubber', label: 'Rubber Studs' },
        { value: 'metal_spikes', label: 'Metal Spikes' },
        { value: 'half_spike', label: 'Half Spike (Hybrid)' },
        { value: 'flat', label: 'Flat / Non-Studded' },
      ],
    },
    {
      key: 'pitch_surface', name: 'Best For Surface', type: 'SINGLE_SELECT', sortOrder: 22,
      choices: [
        { value: 'grass', label: 'Natural Grass' },
        { value: 'astro', label: 'Astro Turf' },
        { value: 'indoor', label: 'Indoor' },
        { value: 'multi', label: 'Multi-Surface' },
      ],
    },
  ],

  // ─── Football Boots ─────────────────────────────────────────────────────
  'football-boots': [
    {
      key: 'stud_config', name: 'Stud Configuration', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 20,
      choices: [
        { value: 'fg', label: 'FG (Firm Ground)' },
        { value: 'sg', label: 'SG (Soft Ground)' },
        { value: 'ag', label: 'AG (Artificial Grass)' },
        { value: 'tf', label: 'TF (Turf / Astro)' },
        { value: 'ic', label: 'IC / IN (Indoor Court)' },
        { value: 'mg', label: 'MG (Multi Ground)' },
      ],
    },
    {
      key: 'boot_collar', name: 'Collar Style', type: 'SINGLE_SELECT', sortOrder: 21,
      choices: [
        { value: 'low', label: 'Low Cut' },
        { value: 'mid', label: 'Mid Cut (Dynamic Fit)' },
        { value: 'high', label: 'High Collar / Sock' },
      ],
    },
    {
      key: 'playing_position', name: 'Best For Position', type: 'MULTI_SELECT', sortOrder: 22,
      choices: [
        { value: 'striker', label: 'Striker / Forward' },
        { value: 'midfielder', label: 'Midfielder' },
        { value: 'defender', label: 'Defender' },
        { value: 'goalkeeper', label: 'Goalkeeper' },
        { value: 'all', label: 'All Positions' },
      ],
    },
  ],

  // ─── Badminton / Training Shoes ─────────────────────────────────────────
  'badminton-shoes': [
    {
      key: 'court_surface', name: 'Court Surface', type: 'SINGLE_SELECT', sortOrder: 20,
      choices: [
        { value: 'indoor_wood', label: 'Indoor (Wooden Court)' },
        { value: 'indoor_synthetic', label: 'Indoor (Synthetic)' },
        { value: 'outdoor', label: 'Outdoor' },
      ],
    },
    {
      key: 'non_marking', name: 'Non-Marking Sole', type: 'BOOLEAN', sortOrder: 21 },
  ],

  'training-shoes': [
    {
      key: 'training_type', name: 'Training Type', type: 'MULTI_SELECT', sortOrder: 20,
      choices: [
        { value: 'gym', label: 'Gym / Weight Training' },
        { value: 'crossfit', label: 'CrossFit / HIIT' },
        { value: 'cardio', label: 'Cardio' },
        { value: 'walking', label: 'Walking' },
        { value: 'general', label: 'General Fitness' },
      ],
    },
    {
      key: 'flat_sole', name: 'Flat Sole (for lifting)', type: 'BOOLEAN', sortOrder: 21 },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // TOP-LEVEL: EQUIPMENT (inherited by Bats, Footballs, Rackets, Gym, Yoga)
  // ═══════════════════════════════════════════════════════════════════════════
  'equipment': [
    {
      key: 'sport', name: 'Sport', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 1,
      choices: [
        { value: 'cricket', label: 'Cricket' },
        { value: 'football', label: 'Football' },
        { value: 'badminton', label: 'Badminton' },
        { value: 'tennis', label: 'Tennis' },
        { value: 'basketball', label: 'Basketball' },
        { value: 'gym', label: 'Gym / Fitness' },
        { value: 'yoga', label: 'Yoga / Pilates' },
        { value: 'swimming', label: 'Swimming' },
        { value: 'hockey', label: 'Hockey' },
        { value: 'other', label: 'Other' },
      ],
    },
    {
      key: 'skill_level', name: 'Skill Level', type: 'SINGLE_SELECT', sortOrder: 2,
      choices: [
        { value: 'beginner', label: 'Beginner' },
        { value: 'intermediate', label: 'Intermediate' },
        { value: 'advanced', label: 'Advanced' },
        { value: 'professional', label: 'Professional' },
        { value: 'all_levels', label: 'All Levels' },
      ],
    },
    {
      key: 'age_group', name: 'Age Group', type: 'SINGLE_SELECT', sortOrder: 3,
      choices: [
        { value: 'adult', label: 'Adult' },
        { value: 'youth', label: 'Youth' },
        { value: 'kids', label: 'Kids' },
        { value: 'all_ages', label: 'All Ages' },
      ],
    },
    {
      key: 'certification', name: 'Certification / Approval', type: 'MULTI_SELECT', sortOrder: 4,
      description: 'Official certifications or league approvals',
      choices: [
        { value: 'icc', label: 'ICC Approved' },
        { value: 'fifa', label: 'FIFA Quality' },
        { value: 'bwf', label: 'BWF Approved' },
        { value: 'bis', label: 'BIS Certified' },
        { value: 'iso', label: 'ISO Certified' },
        { value: 'none', label: 'No Certification' },
      ],
    },
    {
      key: 'includes_carry_case', name: 'Includes Carry Case', type: 'BOOLEAN', sortOrder: 5 },
  ],

  // ─── Cricket Bats ───────────────────────────────────────────────────────
  'cricket-bats': [
    {
      key: 'bat_type', name: 'Bat Type', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 20,
      choices: [
        { value: 'english_willow', label: 'English Willow' },
        { value: 'kashmir_willow', label: 'Kashmir Willow' },
        { value: 'tennis_ball', label: 'Tennis Ball Cricket' },
        { value: 'plastic', label: 'Plastic / PVC' },
      ],
    },
    {
      key: 'bat_size', name: 'Bat Size', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 21,
      choices: [
        { value: 'sh', label: 'SH (Short Handle)' },
        { value: 'lh', label: 'LH (Long Handle)' },
        { value: 'lbs', label: 'LBS (Long Blade Short Handle)' },
        { value: 'size_6', label: 'Size 6 (Youth)' },
        { value: 'size_5', label: 'Size 5 (Junior)' },
        { value: 'size_4', label: 'Size 4' },
        { value: 'size_3', label: 'Size 3' },
        { value: 'harrow', label: 'Harrow' },
      ],
    },
    {
      key: 'willow_grade', name: 'Willow Grade', type: 'SINGLE_SELECT', sortOrder: 22,
      description: 'Quality grade of the willow (1 = best)',
      choices: [
        { value: 'grade_1', label: 'Grade 1 (Premium)' },
        { value: 'grade_2', label: 'Grade 2' },
        { value: 'grade_3', label: 'Grade 3' },
        { value: 'grade_4', label: 'Grade 4 (Practice)' },
        { value: 'grade_a', label: 'Grade A' },
      ],
    },
    {
      key: 'bat_profile', name: 'Bat Profile', type: 'SINGLE_SELECT', sortOrder: 23,
      choices: [
        { value: 'full', label: 'Full Profile (Power)' },
        { value: 'mid', label: 'Mid Profile (Balanced)' },
        { value: 'low', label: 'Low Profile (Lightweight)' },
      ],
    },
    {
      key: 'sweet_spot', name: 'Sweet Spot Position', type: 'SINGLE_SELECT', sortOrder: 24,
      choices: [
        { value: 'low', label: 'Low (Front foot players)' },
        { value: 'mid', label: 'Mid (All-rounders)' },
        { value: 'high', label: 'High (Back foot players)' },
      ],
    },
    {
      key: 'bat_weight_oz', name: 'Bat Weight (approx. oz)', type: 'NUMBER_INTEGER', sortOrder: 25,
      description: 'Weight in ounces (e.g., 40–48 oz for SH)',
    },
    {
      key: 'handle_type', name: 'Handle Type', type: 'SINGLE_SELECT', sortOrder: 26,
      choices: [
        { value: 'round', label: 'Round Handle' },
        { value: 'oval', label: 'Oval Handle' },
        { value: 'semi_oval', label: 'Semi-Oval Handle' },
      ],
    },
    {
      key: 'pre_knocked', name: 'Pre-Knocked In', type: 'BOOLEAN', sortOrder: 27 },
  ],

  // ─── Footballs ──────────────────────────────────────────────────────────
  'footballs': [
    {
      key: 'ball_type', name: 'Ball Type', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 20,
      choices: [
        { value: 'match', label: 'Match Ball' },
        { value: 'training', label: 'Training Ball' },
        { value: 'futsal', label: 'Futsal' },
        { value: 'beach', label: 'Beach Football' },
        { value: 'mini', label: 'Mini / Skills Ball' },
      ],
    },
    {
      key: 'ball_size', name: 'Ball Size', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 21,
      choices: [
        { value: 'size_5', label: 'Size 5 (Standard Adult)' },
        { value: 'size_4', label: 'Size 4 (Youth 8-12)' },
        { value: 'size_3', label: 'Size 3 (Kids under 8)' },
        { value: 'size_1', label: 'Size 1 (Mini / Skills)' },
        { value: 'futsal', label: 'Futsal Size (Low Bounce)' },
      ],
    },
    {
      key: 'panel_count', name: 'Panel Count', type: 'SINGLE_SELECT', sortOrder: 22,
      choices: [
        { value: '32', label: '32 Panels (Classic)' },
        { value: '18', label: '18 Panels' },
        { value: '12', label: '12 Panels' },
        { value: '6', label: '6 Panels (Modern)' },
        { value: 'seamless', label: 'Seamless / Thermally Bonded' },
      ],
    },
    {
      key: 'outer_material', name: 'Outer Material', type: 'SINGLE_SELECT', sortOrder: 23,
      choices: [
        { value: 'pu', label: 'PU (Polyurethane)' },
        { value: 'pvc', label: 'PVC' },
        { value: 'rubber', label: 'Rubber' },
        { value: 'synthetic_leather', label: 'Synthetic Leather' },
        { value: 'tpu', label: 'TPU' },
      ],
    },
    {
      key: 'bladder_type', name: 'Bladder Type', type: 'SINGLE_SELECT', sortOrder: 24,
      choices: [
        { value: 'latex', label: 'Latex (Better feel)' },
        { value: 'butyl', label: 'Butyl (Better air retention)' },
      ],
    },
  ],

  // ─── Badminton Rackets ──────────────────────────────────────────────────
  'badminton-rackets': [
    {
      key: 'racket_weight', name: 'Weight Class', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 20,
      choices: [
        { value: '1u', label: '1U (95-100g, Heavy)' },
        { value: '2u', label: '2U (90-94g)' },
        { value: '3u', label: '3U (85-89g)' },
        { value: '4u', label: '4U (80-84g)' },
        { value: '5u', label: '5U (75-79g, Lightweight)' },
        { value: '6u', label: '6U (70-74g, Ultra Light)' },
      ],
    },
    {
      key: 'balance_point', name: 'Balance', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 21,
      choices: [
        { value: 'head_heavy', label: 'Head Heavy (Power)' },
        { value: 'even', label: 'Even Balance (All-round)' },
        { value: 'head_light', label: 'Head Light (Speed)' },
      ],
    },
    {
      key: 'shaft_flex', name: 'Shaft Flexibility', type: 'SINGLE_SELECT', sortOrder: 22,
      choices: [
        { value: 'flexible', label: 'Flexible (Beginners)' },
        { value: 'medium', label: 'Medium' },
        { value: 'stiff', label: 'Stiff (Advanced)' },
        { value: 'extra_stiff', label: 'Extra Stiff (Pro)' },
      ],
    },
    {
      key: 'frame_material', name: 'Frame Material', type: 'SINGLE_SELECT', sortOrder: 23,
      choices: [
        { value: 'graphite', label: 'Graphite / Carbon Fiber' },
        { value: 'aluminum', label: 'Aluminum' },
        { value: 'steel', label: 'Steel' },
        { value: 'carbon_composite', label: 'Carbon Composite' },
        { value: 'titanium_alloy', label: 'Titanium Alloy' },
      ],
    },
    {
      key: 'string_tension', name: 'Max String Tension (lbs)', type: 'NUMBER_INTEGER', sortOrder: 24 },
    {
      key: 'pre_strung', name: 'Pre-Strung', type: 'BOOLEAN', sortOrder: 25 },
    {
      key: 'grip_size', name: 'Grip Size', type: 'SINGLE_SELECT', sortOrder: 26,
      choices: [
        { value: 'g4', label: 'G4 (Small)' },
        { value: 'g5', label: 'G5 (Medium, Most Common)' },
        { value: 'g6', label: 'G6 (Large)' },
      ],
    },
  ],

  // ─── Gym Equipment ──────────────────────────────────────────────────────
  'gym-equipment': [
    {
      key: 'equipment_type', name: 'Equipment Type', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 20,
      choices: [
        { value: 'dumbbells', label: 'Dumbbells' },
        { value: 'kettlebell', label: 'Kettlebell' },
        { value: 'barbell', label: 'Barbell' },
        { value: 'weight_plates', label: 'Weight Plates' },
        { value: 'resistance_band', label: 'Resistance Band' },
        { value: 'pull_up_bar', label: 'Pull-Up Bar' },
        { value: 'bench', label: 'Bench / Rack' },
        { value: 'jump_rope', label: 'Jump Rope / Skipping Rope' },
        { value: 'foam_roller', label: 'Foam Roller' },
        { value: 'ab_roller', label: 'Ab Roller' },
        { value: 'other', label: 'Other' },
      ],
    },
    {
      key: 'weight_kg', name: 'Weight (kg)', type: 'NUMBER_DECIMAL', sortOrder: 21 },
    {
      key: 'adjustable', name: 'Adjustable', type: 'BOOLEAN', sortOrder: 22 },
    {
      key: 'home_gym_friendly', name: 'Home Gym Friendly', type: 'BOOLEAN', sortOrder: 23 },
  ],

  // ─── Yoga Mats ──────────────────────────────────────────────────────────
  'yoga-mats': [
    {
      key: 'mat_material', name: 'Mat Material', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 20,
      choices: [
        { value: 'pvc', label: 'PVC' },
        { value: 'tpe', label: 'TPE (Eco-friendly)' },
        { value: 'natural_rubber', label: 'Natural Rubber' },
        { value: 'cork', label: 'Cork' },
        { value: 'jute', label: 'Jute' },
        { value: 'nbr', label: 'NBR (Extra Cushion)' },
        { value: 'microfiber', label: 'Microfiber / Suede' },
      ],
    },
    {
      key: 'thickness_mm', name: 'Thickness (mm)', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 21,
      choices: [
        { value: '2', label: '2mm (Travel)' },
        { value: '3', label: '3mm (Thin)' },
        { value: '4', label: '4mm (Standard)' },
        { value: '5', label: '5mm' },
        { value: '6', label: '6mm (Extra Cushion)' },
        { value: '8', label: '8mm (Thick / Joint Support)' },
        { value: '10', label: '10mm+ (Extra Thick)' },
      ],
    },
    {
      key: 'non_slip', name: 'Non-Slip Surface', type: 'BOOLEAN', sortOrder: 22 },
    {
      key: 'eco_friendly', name: 'Eco-Friendly', type: 'BOOLEAN', sortOrder: 23 },
    {
      key: 'includes_strap', name: 'Includes Carry Strap', type: 'BOOLEAN', sortOrder: 24 },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // TOP-LEVEL: ACCESSORIES (inherited by Bags, Socks, Gloves, Caps, Bottles)
  // ═══════════════════════════════════════════════════════════════════════════
  'accessories': [
    {
      key: 'target_gender', name: 'Target Gender', type: 'SINGLE_SELECT', sortOrder: 1,
      choices: [
        { value: 'men', label: 'Men' },
        { value: 'women', label: 'Women' },
        { value: 'unisex', label: 'Unisex' },
        { value: 'kids', label: 'Kids' },
      ],
    },
    {
      key: 'sport', name: 'Sport', type: 'MULTI_SELECT', sortOrder: 2,
      choices: [
        { value: 'cricket', label: 'Cricket' },
        { value: 'football', label: 'Football' },
        { value: 'badminton', label: 'Badminton' },
        { value: 'running', label: 'Running' },
        { value: 'gym', label: 'Gym / Training' },
        { value: 'yoga', label: 'Yoga' },
        { value: 'general', label: 'General / Multi-sport' },
      ],
    },
    {
      key: 'material', name: 'Material', type: 'SINGLE_SELECT', sortOrder: 3,
      choices: [
        { value: 'cotton', label: 'Cotton' },
        { value: 'polyester', label: 'Polyester' },
        { value: 'nylon', label: 'Nylon' },
        { value: 'leather', label: 'Leather' },
        { value: 'synthetic', label: 'Synthetic' },
        { value: 'rubber', label: 'Rubber' },
        { value: 'silicone', label: 'Silicone' },
        { value: 'metal', label: 'Metal' },
        { value: 'plastic', label: 'Plastic' },
      ],
    },
  ],

  // ─── Bags ───────────────────────────────────────────────────────────────
  'bags': [
    {
      key: 'bag_type', name: 'Bag Type', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 20,
      choices: [
        { value: 'backpack', label: 'Backpack' },
        { value: 'duffle', label: 'Duffle Bag' },
        { value: 'kit_bag', label: 'Kit Bag' },
        { value: 'sling', label: 'Sling / Shoulder Bag' },
        { value: 'shoe_bag', label: 'Shoe Bag' },
        { value: 'bat_cover', label: 'Bat Cover' },
        { value: 'racket_bag', label: 'Racket Bag' },
        { value: 'gym_bag', label: 'Gym Bag' },
        { value: 'drawstring', label: 'Drawstring Bag' },
        { value: 'waist', label: 'Waist / Belt Bag' },
      ],
    },
    {
      key: 'capacity_liters', name: 'Capacity (Liters)', type: 'NUMBER_INTEGER', sortOrder: 21 },
    {
      key: 'waterproof', name: 'Waterproof', type: 'BOOLEAN', sortOrder: 22 },
    {
      key: 'laptop_compartment', name: 'Laptop Compartment', type: 'BOOLEAN', sortOrder: 23 },
    {
      key: 'shoe_compartment', name: 'Separate Shoe Compartment', type: 'BOOLEAN', sortOrder: 24 },
    {
      key: 'wheels', name: 'Has Wheels', type: 'BOOLEAN', sortOrder: 25 },
  ],

  // ─── Socks ──────────────────────────────────────────────────────────────
  'socks': [
    {
      key: 'sock_length', name: 'Length', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 20,
      choices: [
        { value: 'no_show', label: 'No-Show / Invisible' },
        { value: 'ankle', label: 'Ankle' },
        { value: 'quarter', label: 'Quarter' },
        { value: 'crew', label: 'Crew' },
        { value: 'knee_high', label: 'Knee-High' },
      ],
    },
    {
      key: 'cushioning', name: 'Cushioning', type: 'SINGLE_SELECT', sortOrder: 21,
      choices: [
        { value: 'light', label: 'Light / Thin' },
        { value: 'medium', label: 'Medium' },
        { value: 'heavy', label: 'Heavy / Maximum' },
      ],
    },
    {
      key: 'anti_odor', name: 'Anti-Odor', type: 'BOOLEAN', sortOrder: 22 },
    {
      key: 'arch_support', name: 'Arch Support', type: 'BOOLEAN', sortOrder: 23 },
    {
      key: 'pack_quantity', name: 'Pack Quantity', type: 'NUMBER_INTEGER', sortOrder: 24,
      description: 'Number of pairs in the pack',
    },
  ],

  // ─── Gloves ─────────────────────────────────────────────────────────────
  'gloves': [
    {
      key: 'glove_type', name: 'Glove Type', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 20,
      choices: [
        { value: 'batting', label: 'Batting Gloves' },
        { value: 'wicket_keeping', label: 'Wicket Keeping Gloves' },
        { value: 'football_gk', label: 'Football Goalkeeper' },
        { value: 'gym', label: 'Gym / Training Gloves' },
        { value: 'cycling', label: 'Cycling Gloves' },
        { value: 'general', label: 'General Sports' },
      ],
    },
    {
      key: 'hand', name: 'Hand', type: 'SINGLE_SELECT', sortOrder: 21,
      choices: [
        { value: 'right', label: 'Right Hand' },
        { value: 'left', label: 'Left Hand' },
        { value: 'pair', label: 'Pair (Both Hands)' },
        { value: 'ambidextrous', label: 'Ambidextrous' },
      ],
    },
    {
      key: 'padding', name: 'Padding Level', type: 'SINGLE_SELECT', sortOrder: 22,
      choices: [
        { value: 'light', label: 'Light' },
        { value: 'medium', label: 'Medium' },
        { value: 'heavy', label: 'Heavy / Pro' },
      ],
    },
    {
      key: 'finger_coverage', name: 'Finger Coverage', type: 'SINGLE_SELECT', sortOrder: 23,
      choices: [
        { value: 'full', label: 'Full Finger' },
        { value: 'half', label: 'Half Finger / Fingerless' },
      ],
    },
  ],

  // ─── Batting Gloves (top-level, standalone) ─────────────────────────────
  'batting-gloves': [
    {
      key: 'target_gender', name: 'Target Gender', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 1,
      choices: [
        { value: 'men', label: 'Men' },
        { value: 'women', label: 'Women' },
        { value: 'youth', label: 'Youth' },
      ],
    },
    {
      key: 'age_group', name: 'Age Group', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 2,
      choices: [
        { value: 'adult', label: 'Adult' },
        { value: 'youth', label: 'Youth' },
        { value: 'kids', label: 'Kids' },
      ],
    },
    {
      key: 'hand', name: 'Hand Orientation', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 3,
      description: 'Select based on batting hand (RH batsman wears on left hand)',
      choices: [
        { value: 'right_hand_batsman', label: 'Right-Hand Batsman' },
        { value: 'left_hand_batsman', label: 'Left-Hand Batsman' },
      ],
    },
    {
      key: 'material', name: 'Palm Material', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 4,
      choices: [
        { value: 'leather', label: 'Premium Leather' },
        { value: 'synthetic_leather', label: 'Synthetic Leather' },
        { value: 'pu', label: 'PU (Polyurethane)' },
        { value: 'cotton', label: 'Cotton' },
      ],
    },
    {
      key: 'skill_level', name: 'Skill Level', type: 'SINGLE_SELECT', sortOrder: 5,
      choices: [
        { value: 'beginner', label: 'Beginner / Club' },
        { value: 'intermediate', label: 'Intermediate / District' },
        { value: 'advanced', label: 'Advanced / State' },
        { value: 'professional', label: 'Professional / International' },
      ],
    },
    {
      key: 'padding', name: 'Padding Level', type: 'SINGLE_SELECT', sortOrder: 6,
      choices: [
        { value: 'light', label: 'Light (Gully Cricket)' },
        { value: 'medium', label: 'Medium' },
        { value: 'heavy', label: 'Heavy (Pro Grade)' },
      ],
    },
    {
      key: 'finger_split', name: 'Finger Split Design', type: 'BOOLEAN', sortOrder: 7,
      description: 'Split finger design for better flexibility',
    },
    {
      key: 'ventilation', name: 'Ventilation', type: 'BOOLEAN', sortOrder: 8,
      description: 'Mesh or perforated ventilation for breathability',
    },
  ],

  // ─── Caps ───────────────────────────────────────────────────────────────
  'caps': [
    {
      key: 'cap_type', name: 'Cap Type', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 20,
      choices: [
        { value: 'baseball', label: 'Baseball Cap' },
        { value: 'running', label: 'Running Cap' },
        { value: 'bucket', label: 'Bucket Hat' },
        { value: 'visor', label: 'Visor' },
        { value: 'beanie', label: 'Beanie' },
        { value: 'headband', label: 'Headband' },
        { value: 'trucker', label: 'Trucker Cap' },
      ],
    },
    {
      key: 'closure', name: 'Closure', type: 'SINGLE_SELECT', sortOrder: 21,
      choices: [
        { value: 'adjustable_strap', label: 'Adjustable Strap' },
        { value: 'snapback', label: 'Snapback' },
        { value: 'fitted', label: 'Fitted (No Adjustment)' },
        { value: 'elastic', label: 'Elastic' },
        { value: 'drawcord', label: 'Drawcord' },
      ],
    },
    {
      key: 'uv_protection', name: 'UV Protection', type: 'BOOLEAN', sortOrder: 22 },
    {
      key: 'sweatband', name: 'Sweatband', type: 'BOOLEAN', sortOrder: 23,
      description: 'Built-in sweat-wicking headband',
    },
  ],

  // ─── Water Bottles ──────────────────────────────────────────────────────
  'water-bottles': [
    {
      key: 'bottle_material', name: 'Bottle Material', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 20,
      choices: [
        { value: 'plastic', label: 'BPA-Free Plastic' },
        { value: 'stainless_steel', label: 'Stainless Steel' },
        { value: 'glass', label: 'Glass' },
        { value: 'tritan', label: 'Tritan' },
        { value: 'silicone', label: 'Collapsible Silicone' },
        { value: 'aluminium', label: 'Aluminium' },
      ],
    },
    {
      key: 'capacity_ml', name: 'Capacity (ml)', type: 'SINGLE_SELECT', isRequired: true, sortOrder: 21,
      choices: [
        { value: '350', label: '350 ml' },
        { value: '500', label: '500 ml' },
        { value: '600', label: '600 ml' },
        { value: '750', label: '750 ml' },
        { value: '1000', label: '1 Liter' },
        { value: '1500', label: '1.5 Liters' },
        { value: '2000', label: '2 Liters' },
      ],
    },
    {
      key: 'insulated', name: 'Insulated (Hot/Cold)', type: 'BOOLEAN', sortOrder: 22 },
    {
      key: 'leak_proof', name: 'Leak Proof', type: 'BOOLEAN', sortOrder: 23 },
    {
      key: 'lid_type', name: 'Lid Type', type: 'SINGLE_SELECT', sortOrder: 24,
      choices: [
        { value: 'screw', label: 'Screw Cap' },
        { value: 'flip', label: 'Flip-Top' },
        { value: 'straw', label: 'Straw' },
        { value: 'squeeze', label: 'Squeeze Nozzle' },
        { value: 'chug', label: 'Chug Spout' },
      ],
    },
    {
      key: 'dishwasher_safe', name: 'Dishwasher Safe', type: 'BOOLEAN', sortOrder: 25 },
  ],
};


// ─────────────────────────────────────────────────────────────────────────────
// SEEDER
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding category metafield definitions...\n');

  // Get all categories
  const categories = await prisma.category.findMany({ select: { id: true, slug: true, name: true } });
  const catMap = new Map(categories.map((c) => [c.slug, c]));

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const [slug, attrs] of Object.entries(CATEGORY_ATTRIBUTES)) {
    const category = catMap.get(slug);
    if (!category) {
      console.log(`  ⚠  Category "${slug}" not found in database — skipping ${attrs.length} attributes`);
      totalSkipped += attrs.length;
      continue;
    }

    console.log(`  📂 ${category.name} (${slug}) — ${attrs.length} attributes`);

    for (const attr of attrs) {
      // Check if already exists
      const existing = await prisma.metafieldDefinition.findFirst({
        where: { namespace: 'taxonomy', key: attr.key, categoryId: category.id },
      });

      if (existing) {
        console.log(`     ⏭  ${attr.name} (taxonomy.${attr.key}) — already exists`);
        totalSkipped++;
        continue;
      }

      await prisma.metafieldDefinition.create({
        data: {
          namespace: 'taxonomy',
          key: attr.key,
          name: attr.name,
          description: attr.description || null,
          type: attr.type as any,
          choices: attr.choices || undefined,
          ownerType: 'CATEGORY',
          categoryId: category.id,
          isRequired: attr.isRequired ?? false,
          sortOrder: attr.sortOrder ?? 0,
        },
      });

      console.log(`     ✅ ${attr.name} (taxonomy.${attr.key}) — created`);
      totalCreated++;
    }
  }

  console.log(`\n🎉 Done! Created ${totalCreated} definitions, skipped ${totalSkipped}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
