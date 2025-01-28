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
    single_user_bulk_create: {
      executor: 'constant-vus',
      vus: 1,
      duration: '60s',
    },
  },
  thresholds: {
    http_req_duration: [
      'p(95)<3000',  // 3s for 95th percentile (accounting for cold starts)
      'p(99)<4000',  // 4s for edge cases
      'avg<2000',    // Average should stay under 2s
    ],
    http_req_failed: ['rate<0.01'],
  },
  // Multiple APAC zones distribution
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

// Track batches for 1000 shifts
let batchCounter = 0;
const TOTAL_BATCHES = 10; // 10 batches of 100 shifts = 1000 shifts

export default function () {
  if (batchCounter >= TOTAL_BATCHES) {
    console.log('All 1000 shifts have been queued for creation');
    return;
  }

  const currentBatch = batchCounter++;
  
  const url = __ENV.API_URL + '/api/v1/shifts/batch/create';
  const payload = JSON.stringify({
    shifts: generateYearlyShifts(currentBatch)
  });
  
  const headers = {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'k6-test',
  };

  console.log(`Sending batch ${currentBatch + 1} of ${TOTAL_BATCHES} (100 shifts)`);

  try {
    const response = http.post(url, payload, { 
      headers,
      timeout: '30s',
      throw_on_error: false,
    });

    console.log(`Batch ${currentBatch + 1} response status: ${response.status}`);
    
    if (response.status !== 201) {
      errorRate.add(1);
      console.log(`Error in batch ${currentBatch + 1}: Status ${response.status}, Body: ${response.body}`);
    }

    if (response.timings.duration > 2000) {
      slowResponseRate.add(1);
      console.log(`Slow response for batch ${currentBatch + 1}: ${response.timings.duration}ms`);
    }

    check(response, {
      'is status 201': (r) => r.status === 201,
      'response time < 2000ms': (r) => r.timings.duration < 2000,
      'batch creation successful': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body && Array.isArray(body.data) && body.data.length > 0;
        } catch (e) {
          console.log(`JSON parse error in batch ${currentBatch + 1}:`, e);
          return false;
        }
      },
    });

    // Add a small delay between batches to simulate realistic usage
    sleep(1);

  } catch (error) {
    console.error(`Request failed for batch ${currentBatch + 1}:`, error);
    errorRate.add(1);
  }
}

function generateYearlyShifts(batchIndex = 0) {
  const shifts = [];
  const baseDate = new Date('2025/01/01'); // Starting from next year
  const shiftPatterns = [
    { start: "09:00", end: "17:00" },  // Day shift
    { start: "14:00", end: "22:00" },  // Afternoon shift
    { start: "16:00", end: "00:00" },  // Evening shift
    { start: "00:00", end: "08:00" }   // Night shift
  ];
  
  for (let i = 0; i < 100; i++) {
    const globalIndex = (batchIndex * 100) + i;
    const daysToAdd = Math.floor(globalIndex / 4); // 4 shifts per day
    
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
        batchId: `yearly-batch-${batchIndex}-${Date.now()}`,
        location: ["Main Office", "Branch A", "Branch B", "Remote"][i % 4]
      },
      tags: [
        { name: ["Morning", "Afternoon", "Evening", "Night"][i % 4] }
      ],
      customFields: [
        {
          fieldId: "cm5xeds9v0000au5l69m1c0ra",
          value: `Yearly Shift ${globalIndex + 1}`
        }
      ]
    });
  }
  
  return shifts;
} 