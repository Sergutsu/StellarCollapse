// ProceduralStarSystem -- generates a deterministic star system with
// 50-100 points of interest (POIs) based on a seed value. Used by the
// StarMapTab for gameplay within a single star system.
//
// The generator creates:
//   - A central star (type, size, color)
//   - Planets (rocky, gas giant, ice, etc.) with orbits
//   - Moons orbiting planets
//   - Asteroid belts
//   - Space stations / waypoints
//   - Anomalies / hazards
//
// All positions are in normalized system coordinates (0..1 range from
// the system center), making it easy to scale to any viewport size.

// Seeded random number generator (Mulberry32)
function createRNG(seed) {
    let t = seed >>> 0;
    return function() {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

// Star classification data
const STAR_TYPES = Object.freeze([
    { type: 'O', color: 0x9bb0ff, temp: '30000K+', radius: 15, luminosity: 1000000 },
    { type: 'B', color: 0xaabfff, temp: '10000-30000K', radius: 12, luminosity: 100000 },
    { type: 'A', color: 0xcbf3ff, temp: '7500-10000K', radius: 8, luminosity: 10000 },
    { type: 'F', color: 0xfff4e6, temp: '6000-7500K', radius: 6, luminosity: 1000 },
    { type: 'G', color: 0xffdf8c, temp: '5200-6000K', radius: 5, luminosity: 100 },
    { type: 'K', color: 0xffb347, temp: '3700-5200K', radius: 4, luminosity: 10 },
    { type: 'M', color: 0xff6b35, temp: '2400-3700K', radius: 3, luminosity: 1 },
]);

// Planet types with visual properties
const PLANET_TYPES = Object.freeze([
    { type: 'Terrestrial', color: 0x8b7355, minOrbit: 0.12, maxOrbit: 0.25, sizeRange: [3, 6], description: 'Rocky world' },
    { type: 'Desert', color: 0xd4a574, minOrbit: 0.10, maxOrbit: 0.30, sizeRange: [3, 5], description: 'Arid wasteland' },
    { type: 'Ocean', color: 0x4a90d9, minOrbit: 0.15, maxOrbit: 0.35, sizeRange: [4, 7], description: 'Water-covered' },
    { type: 'Ice Giant', color: 0x7ec8e3, minOrbit: 0.30, maxOrbit: 0.55, sizeRange: [7, 10], description: 'Frozen atmosphere' },
    { type: 'Gas Giant', color: 0xc9a86c, minOrbit: 0.45, maxOrbit: 0.75, sizeRange: [10, 14], description: 'Massive gaseous' },
    { type: 'Lava', color: 0xff4500, minOrbit: 0.05, maxOrbit: 0.12, sizeRange: [3, 5], description: 'Volcanically active' },
]);

// Station / facility types
const STATION_TYPES = Object.freeze([
    { type: 'Mining Outpost', color: 0x94a3b8, icon: 'diamond' },
    { type: 'Research Station', color: 0x67e8f9, icon: 'flask' },
    { type: 'Trade Hub', color: 0xfcd34d, icon: 'coins' },
    { type: 'Military Base', color: 0xf87171, icon: 'shield' },
    { type: 'Refinery', color: 0xc4b5fd, icon: 'factory' },
    { type: 'Waystation', color: 0x86efac, icon: 'anchor' },
]);

// Hazard / anomaly types
const HAZARD_TYPES = Object.freeze([
    { type: 'Nebula Cloud', color: 0xd8b4fe, threat: 2 },
    { type: 'Radiation Belt', color: 0x22c55e, threat: 3 },
    { type: 'Gravitational Anomaly', color: 0xa855f7, threat: 4 },
    { type: 'Debris Field', color: 0x94a3b8, threat: 1 },
    { type: 'Quantum Rift', color: 0xec4899, threat: 5 },
]);

// Ship icon colors by faction/type
const SHIP_COLORS = Object.freeze({
    player: 0x67e8f9,
    friendly: 0x86efac,
    neutral: 0xfcd34d,
    hostile: 0xf87171,
});

/**
 * Generate a complete star system with procedural content.
 * @param {number} seed - Deterministic seed for reproducibility
 * @returns {Object} Generated star system data
 */
export function generateStarSystem(seed) {
    const rng = createRNG(seed);
    
    // Generate central star
    const starIndex = Math.floor(rng() * STAR_TYPES.length);
    const starType = STAR_TYPES[starIndex];
    
    const star = {
        id: 'central-star',
        name: `Star-${seed.toString(16).toUpperCase().slice(0, 4)}`,
        type: starType.type,
        color: starType.color,
        radius: starType.radius,
        temperature: starType.temp,
        luminosity: starType.luminosity,
        x: 0.5,
        y: 0.5,
    };
    
    const pois = [];
    const orbits = [];
    
    // Generate planets (4-8 planets based on seed)
    const planetCount = 4 + Math.floor(rng() * 5);
    const usedOrbits = new Set();
    
    for (let i = 0; i < planetCount; i++) {
        const planetTypeIdx = Math.floor(rng() * PLANET_TYPES.length);
        const planetType = PLANET_TYPES[planetTypeIdx];
        
        // Find unused orbit slot
        let orbitRadius;
        let attempts = 0;
        do {
            orbitRadius = planetType.minOrbit + rng() * (planetType.maxOrbit - planetType.minOrbit);
            attempts++;
        } while (usedOrbits.has(Math.round(orbitRadius * 100)) && attempts < 20);
        usedOrbits.add(Math.round(orbitRadius * 100));
        
        const size = planetType.sizeRange[0] + rng() * (planetType.sizeRange[1] - planetType.sizeRange[0]);
        const angle = rng() * Math.PI * 2;
        
        const planet = {
            id: `planet-${i}`,
            name: `${star.name}-${String.fromCharCode(65 + i)}`,
            type: planetType.type,
            color: planetType.color,
            radius: size,
            orbitRadius: orbitRadius,
            orbitSpeed: 0.0001 + rng() * 0.0003,
            orbitAngle: angle,
            description: planetType.description,
            poiType: 'planet',
            threat: Math.floor(rng() * 3) + 1,
            resources: generateResources(rng),
        };
        
        pois.push(planet);
        orbits.push({
            parentId: 'central-star',
            radius: orbitRadius,
            color: planetType.color,
            alpha: 0.15,
        });
        
        // Generate moons for larger planets (0-4 moons)
        if (size > 5) {
            const moonCount = Math.floor(rng() * 5);
            for (let m = 0; m < moonCount; m++) {
                const moonOrbit = 0.02 + rng() * 0.04;
                const moonSize = 1 + rng() * 2;
                const moonAngle = rng() * Math.PI * 2;
                
                const moon = {
                    id: `moon-${i}-${m}`,
                    name: `${planet.name}-${m + 1}`,
                    type: 'Moon',
                    color: 0x888888 + Math.floor(rng() * 0x444444),
                    radius: moonSize,
                    orbitRadius: moonOrbit,
                    orbitSpeed: 0.0005 + rng() * 0.001,
                    orbitAngle: moonAngle,
                    parentId: planet.id,
                    parentOrbitRadius: orbitRadius,
                    description: 'Natural satellite',
                    poiType: 'moon',
                    threat: Math.floor(rng() * 2),
                    resources: generateResources(rng),
                };
                pois.push(moon);
            }
        }
    }
    
    // Generate asteroid belts (1-2 belts)
    const beltCount = 1 + Math.floor(rng() * 2);
    for (let b = 0; b < beltCount; b++) {
        const beltInner = 0.20 + rng() * 0.30;
        const beltOuter = beltInner + 0.05 + rng() * 0.08;
        
        const belt = {
            id: `belt-${b}`,
            name: `${star.name} Belt ${b + 1}`,
            type: 'Asteroid Belt',
            color: 0xd4a574,
            innerRadius: beltInner,
            outerRadius: beltOuter,
            density: 0.3 + rng() * 0.5,
            poiType: 'belt',
            threat: 2,
            resources: { minerals: 50 + Math.floor(rng() * 100), o2: 0, fuel: 0 },
        };
        pois.push(belt);
        
        orbits.push({
            parentId: 'central-star',
            radius: (beltInner + beltOuter) / 2,
            color: 0xd4a574,
            alpha: 0.08,
            isBelt: true,
            width: beltOuter - beltInner,
        });
    }
    
    // Generate space stations (3-6 stations)
    const stationCount = 3 + Math.floor(rng() * 4);
    for (let s = 0; s < stationCount; s++) {
        const stationType = STATION_TYPES[Math.floor(rng() * STATION_TYPES.length)];
        const orbitRadius = 0.15 + rng() * 0.55;
        const angle = rng() * Math.PI * 2;
        
        const station = {
            id: `station-${s}`,
            name: `${stationType.type} ${String.fromCharCode(65 + s)}`,
            type: stationType.type,
            color: stationType.color,
            radius: 4,
            orbitRadius: orbitRadius,
            orbitSpeed: 0.00005,
            orbitAngle: angle,
            icon: stationType.icon,
            poiType: 'station',
            threat: 0,
            services: generateStationServices(rng, stationType),
        };
        pois.push(station);
    }
    
    // Generate hazards/anomalies (2-5)
    const hazardCount = 2 + Math.floor(rng() * 4);
    for (let h = 0; h < hazardCount; h++) {
        const hazardType = HAZARD_TYPES[Math.floor(rng() * HAZARD_TYPES.length)];
        const orbitRadius = 0.10 + rng() * 0.70;
        const angle = rng() * Math.PI * 2;
        
        const hazard = {
            id: `hazard-${h}`,
            name: `${hazardType.type} ${h + 1}`,
            type: hazardType.type,
            color: hazardType.color,
            radius: 5 + rng() * 8,
            orbitRadius: orbitRadius,
            orbitSpeed: 0.00002,
            orbitAngle: angle,
            poiType: 'hazard',
            threat: hazardType.threat,
            description: 'Navigational hazard',
        };
        pois.push(hazard);
    }
    
    // Generate ships in orbit (5-15 ships)
    const shipCount = 5 + Math.floor(rng() * 11);
    const ships = [];
    for (let i = 0; i < shipCount; i++) {
        const shipTypes = ['Scout', 'Freighter', 'Miner', 'Escort', 'Explorer'];
        const shipType = shipTypes[Math.floor(rng() * shipTypes.length)];
        const factions = ['player', 'friendly', 'neutral', 'hostile'];
        const faction = factions[Math.floor(rng() * factions.length)];
        
        // Assign ship to orbit around a POI
        const targetPoi = pois[Math.floor(rng() * pois.length)];
        const shipOrbitRadius = 0.03 + rng() * 0.06;
        const shipAngle = rng() * Math.PI * 2;
        
        const ship = {
            id: `ship-${i}`,
            name: `${faction.charAt(0).toUpperCase() + faction.slice(1)} ${shipType} ${i + 1}`,
            type: shipType,
            faction: faction,
            color: SHIP_COLORS[faction],
            size: 3,
            orbitRadius: shipOrbitRadius,
            orbitSpeed: 0.0002 + rng() * 0.0005,
            orbitAngle: shipAngle,
            parentId: targetPoi.id,
            parentOrbitRadius: targetPoi.orbitRadius || targetPoi.innerRadius || 0.3,
            poiType: 'ship',
        };
        ships.push(ship);
    }
    
    return {
        seed,
        star,
        pois,
        orbits,
        ships,
        bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
    };
}

/**
 * Generate random resource deposits for a POI.
 */
function generateResources(rng) {
    return {
        minerals: Math.floor(rng() * 100),
        o2: Math.floor(rng() * 50),
        fuel: Math.floor(rng() * 30),
        warp: Math.floor(rng() * 10),
    };
}

/**
 * Generate station services based on type.
 */
function generateStationServices(rng, stationType) {
    const allServices = ['refuel', 'repair', 'trade', 'upgrade', 'recruit', 'research'];
    const serviceCount = 2 + Math.floor(rng() * 3);
    const services = [];
    for (let i = 0; i < serviceCount; i++) {
        const idx = Math.floor(rng() * allServices.length);
        if (!services.includes(allServices[idx])) {
            services.push(allServices[idx]);
        }
    }
    return services;
}

/**
 * Calculate current position of an orbiting object.
 * @param {Object} poi - Point of interest with orbit data
 * @param {number} timeMs - Current time in milliseconds
 * @param {Object} parentPoi - Parent POI if this orbits another object
 * @returns {Object} {x, y} position in normalized coordinates
 */
export function calculateOrbitalPosition(poi, timeMs, parentPoi = null) {
    const baseAngle = poi.orbitAngle || 0;
    const speed = poi.orbitSpeed || 0;
    const currentAngle = baseAngle + speed * timeMs;
    
    let centerX, centerY;
    
    if (parentPoi) {
        // Moon or ship orbiting a planet/station
        const parentPos = calculateOrbitalPosition(parentPoi, timeMs, null);
        centerX = parentPos.x;
        centerY = parentPos.y;
    } else if (poi.parentId && poi.parentOrbitRadius !== undefined) {
        // This is handled by the caller passing parentPoi
        centerX = 0.5;
        centerY = 0.5;
    } else {
        // Planet/star orbiting center
        centerX = 0.5;
        centerY = 0.5;
    }
    
    const orbitRadius = poi.orbitRadius || 0;
    const x = centerX + Math.cos(currentAngle) * orbitRadius;
    const y = centerY + Math.sin(currentAngle) * orbitRadius;
    
    return { x, y };
}

/**
 * Get all ships orbiting a specific POI.
 * @param {Array} ships - Array of all ships
 * @param {string} poiId - ID of the POI
 * @returns {Array} Ships orbiting this POI
 */
export function getShipsOrbitingPoi(ships, poiId) {
    return ships.filter(ship => ship.parentId === poiId);
}
