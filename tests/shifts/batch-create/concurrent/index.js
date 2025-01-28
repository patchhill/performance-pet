import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const slowResponseRate = new Rate('slow_responses');
const errorRate = new Rate('error_rate');

const API_KEY = __ENV.API_KEY;
if (!API_KEY) {
  throw new Error('API_KEY environment variable is not set');
}

export const options = {
  scenarios: {
    concurrent_api_users: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5 },  // Ramp up to 5 concurrent users
        { duration: '1m', target: 5 },   // Stay at 5 users
        { duration: '30s', target: 10 }, // Ramp up to 10 users
        { duration: '1m', target: 10 },  // Stay at 10 users
        { duration: '30s', target: 0 },  // Ramp down
      ],
    },
  },
  thresholds: {
    http_req_duration: [
      'p(95)<4000',  // Adjusted for concurrent load
      'p(99)<5000',  // Allow for some spikes
      'avg<2500',    // Higher average allowed for concurrent
    ],
    http_req_failed: ['rate<0.01'],
  },
  // Multiple zones to simulate global API users
  ext: {
    loadimpact: {
      distribution: {
        'amazon:au:sydney': { loadZone: 'amazon:au:sydney', percent: 40 },
        'amazon:sg:singapore': { loadZone: 'amazon:sg:singapore', percent: 30 },
        'amazon:jp:tokyo': { loadZone: 'amazon:jp:tokyo', percent: 30 },
      },
    },
  },
};

// Track batches per VU
const batchesPerVU = new Map();
const BATCHES_PER_USER = 3; // Each user creates 300 shifts (3 batches of 100)

export default function () {
  // Get VU-specific batch counter
  let batchCount = batchesPerVU.get(__VU) || 0;
  
  if (batchCount >= BATCHES_PER_USER) {
    sleep(1); // Keep VU active but idle
    return;
  }

  const url = __ENV.API_URL + '/api/v1/shifts/batch/create';
  const payload = JSON.stringify({
    shifts: generateYearlyShifts(batchCount, __VU)
  });
  
  const headers = {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'k6-test',
  };

  console.log(`VU ${__VU}: Sending batch ${batchCount + 1} of ${BATCHES_PER_USER}`);

  try {
    const response = http.post(url, payload, { 
      headers,
      timeout: '30s',
      throw_on_error: false,
    });

    if (response.status !== 201) {
      errorRate.add(1);
      console.log(`VU ${__VU} Error in batch ${batchCount + 1}: Status ${response.status}`);
    }

    if (response.timings.duration > 2500) {
      slowResponseRate.add(1);
    }

    check(response, {
      'is status 201': (r) => r.status === 201,
      'response time < 2500ms': (r) => r.timings.duration < 2500,
      'batch creation successful': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body && Array.isArray(body.data) && body.data.length > 0;
        } catch (e) {
          return false;
        }
      },
    });

    // Update batch counter for this VU
    batchesPerVU.set(__VU, batchCount + 1);
    
    // Add delay between batches (randomized to prevent thundering herd)
    sleep(Math.random() * 2 + 1); // 1-3 second delay

  } catch (error) {
    console.error(`VU ${__VU} Request failed for batch ${batchCount + 1}:`, error);
    errorRate.add(1);
  }
}

function generateYearlyShifts(batchIndex = 0, vuId = 1) {
  const shifts = [];
  const baseDate = new Date('2025/01/01');
  const shiftPatterns = [
    { start: "09:00", end: "17:00" },
    { start: "14:00", end: "22:00" },
    { start: "16:00", end: "00:00" },
    { start: "00:00", end: "08:00" }
  ];
  
  for (let i = 0; i < 100; i++) {
    const globalIndex = (batchIndex * 100) + i;
    const daysToAdd = Math.floor(globalIndex / 4);
    
    const shiftDate = new Date(baseDate);
    shiftDate.setDate(shiftDate.getDate() + daysToAdd);
    
    shifts.push({
      date: shiftDate.toISOString().split('T')[0],
      startTime: shiftPatterns[i % 4].start,
      endTime: shiftPatterns[i % 4].end,
      rate: Math.floor(Math.random() * (45 - 25) + 25),
      jobId: "cm64ly8v3000013gvb9ceypch",
      status: "available",
      breakTime: 30,
      breakPaid: (i % 2) === 0,
      cost: 320,
      metadata: {
        source: "k6-test",
        batchId: `vu-${vuId}-batch-${batchIndex}-${Date.now()}`,
        location: ["Main Office", "Branch A", "Branch B", "Remote"][i % 4]
      },
      tags: [
        { name: ["Morning", "Afternoon", "Evening", "Night"][i % 4] }
      ],
      customFields: [
        {
          fieldId: "cm5xeds9v0000au5l69m1c0ra",
          value: `VU${vuId}-Shift-${globalIndex + 1}`
        }
      ]
    });
  }
  
  return shifts;
} 
