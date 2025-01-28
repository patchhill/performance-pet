import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { shiftIds } from '../../../../lib/shift-ids.js';

const slowResponseRate = new Rate('slow_responses');
const errorRate = new Rate('error_rate');

const API_KEY = __ENV.API_KEY;
if (!API_KEY) {
  throw new Error('API_KEY environment variable is not set');
}

console.log('Loaded shift IDs:', shiftIds ? shiftIds.length : 'none');

export const options = {
  scenarios: {
    multiple_zones_updates: {
      executor: 'constant-vus',
      vus: 1,
      duration: '60s',
    },
  },
  thresholds: {
    http_req_duration: [
      'p(95)<3000',  // 3s for 95th percentile (accounting for cross-region latency)
      'p(99)<4000',  // 4s for edge cases
      'avg<2000',    // Average should stay under 2s
    ],
    http_req_failed: ['rate<0.01'],
  },
  // Multiple APAC zones distribution (matching create test)
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

function generateBatchUpdates(batchNumber) {
  const batchSize = 100;
  const startIdx = batchNumber * batchSize;
  const batchShiftIds = shiftIds.slice(startIdx, startIdx + batchSize);

  // Debug logging
  console.log(`Batch ${batchNumber + 1} shift IDs count: ${batchShiftIds.length}`);
  if (batchShiftIds.length === 0) {
    console.log('No shift IDs found. First few shift IDs in array:', shiftIds.slice(0, 3));
    console.log('Total shift IDs available:', shiftIds.length);
    console.log('Start index:', startIdx);
  }

  const possibleUpdates = [
    (id) => ({
      id,
      status: 'confirmed',
      metadata: {
        updateSource: 'batch-test',
        updateType: 'status-update',
        batchId: `batch-${batchNumber}-${Date.now()}`
      }
    }),
    (id) => ({
      id,
      rate: Math.floor(Math.random() * (45 - 25) + 25),
      cost: Math.floor(Math.random() * (400 - 300) + 300),
      metadata: {
        updateSource: 'batch-test',
        updateType: 'rate-update',
        batchId: `batch-${batchNumber}-${Date.now()}`
      }
    }),
    (id) => ({
      id,
      startTime: '10:00',
      endTime: '18:00',
      metadata: {
        updateSource: 'batch-test',
        updateType: 'time-update',
        batchId: `batch-${batchNumber}-${Date.now()}`
      }
    }),
    (id) => ({
      id,
      customFields: [
        {
          fieldId: "cm5xeds9v0000au5l69m1c0ra",
          value: `Updated Value ${Date.now()}`
        }
      ],
      metadata: {
        updateSource: 'batch-test',
        updateType: 'custom-field-update',
        batchId: `batch-${batchNumber}-${Date.now()}`
      }
    })
  ];

  const updates = batchShiftIds.map(id => {
    const updateType = possibleUpdates[Math.floor(Math.random() * possibleUpdates.length)];
    return updateType(id);
  });

  // Add debug logging for the final payload
  console.log(`Generated updates count: ${updates.length}`);
  if (updates.length === 0) {
    console.log('No updates generated');
  } else {
    console.log('Sample update:', updates[0]);
  }

  return { shifts: updates };
}

export default function () {
  if (batchCounter >= TOTAL_BATCHES) {
    console.log('All 1000 shifts have been processed');
    return;
  }

  const currentBatch = batchCounter++;
  
  const url = __ENV.API_URL + '/api/v1/shifts/batch/update';
  const payload = JSON.stringify(generateBatchUpdates(currentBatch));
  
  const headers = {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'k6-test',
  };

  console.log(`Sending batch ${currentBatch + 1} of ${TOTAL_BATCHES} (100 shifts)`);

  try {
    const response = http.patch(url, payload, { 
      headers,
      timeout: '30s',
      throw_on_error: false,
    });

    console.log(`Batch ${currentBatch + 1} response status: ${response.status}`);
    
    if (response.status !== 200) {
      errorRate.add(1);
      console.log(`Error in batch ${currentBatch + 1}: Status ${response.status}, Body: ${response.body}`);
    }

    if (response.timings.duration > 2000) {
      slowResponseRate.add(1);
      console.log(`Slow response for batch ${currentBatch + 1}: ${response.timings.duration}ms`);
    }

    check(response, {
      'is status 200': (r) => r.status === 200,
      'response time < 2000ms': (r) => r.timings.duration < 2000,
      'batch update successful': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body && body.success === true;
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
