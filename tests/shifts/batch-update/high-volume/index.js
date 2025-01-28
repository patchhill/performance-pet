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

export const options = {
  scenarios: {
    enterprise_batch_load: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 2 },   // Start with 2 higher-tier users
        { duration: '1m', target: 2 },    // Maintain load
        { duration: '30s', target: 3 },   // Increase to 3 users
        { duration: '1m', target: 3 },    // Maintain higher load
        { duration: '30s', target: 0 },   // Ramp down
      ],
    },
  },
  thresholds: {
    http_req_duration: [
      'p(95)<5000',  // 5s for 95th percentile (higher for larger batches)
      'p(99)<7000',  // 7s for edge cases
      'avg<3000',    // Average should stay under 3s
    ],
    http_req_failed: ['rate<0.01'],
  },
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
const BATCHES_PER_USER = 20; // Each user updates 2000 shifts (20 batches of 100)
const CONCURRENT_BATCHES = 5; // Higher tier allows 5 concurrent requests

function generateBatchUpdates(batchIndex, vuId) {
  const updateTypes = [
    // Full update
    (id) => ({
      id,
      startTime: "09:00",
      endTime: "18:00",
      status: "available",
      rate: Math.floor(Math.random() * (45 - 25) + 25),
      cost: Math.floor(Math.random() * (400 - 300) + 300),
      metadata: {
        source: "k6-enterprise-test",
        batchId: `enterprise-vu-${vuId}-batch-${batchIndex}-${Date.now()}`,
      },
      tags: [{ name: ["Morning", "Afternoon", "Evening", "Night"][Math.floor(Math.random() * 4)] }]
    }),
    // Minimal update
    (id) => ({
      id,
      status: "confirmed",
      metadata: {
        source: "k6-enterprise-test",
        batchId: `enterprise-vu-${vuId}-batch-${batchIndex}-${Date.now()}`,
        updateType: "status-only"
      }
    }),
    // Medium update
    (id) => ({
      id,
      rate: Math.floor(Math.random() * (45 - 25) + 25),
      cost: Math.floor(Math.random() * (400 - 300) + 300),
      customFields: [{
        fieldId: "cm5xeds9v0000au5l69m1c0ra",
        value: `Enterprise-VU${vuId}-Batch${batchIndex}-${Date.now()}`
      }]
    })
  ];

  // Take a random subset of shift IDs for this batch
  const startIdx = (batchIndex * 100) % shiftIds.length;
  const selectedShiftIds = [...shiftIds]
    .slice(startIdx, startIdx + 100)
    .sort(() => Math.random() - 0.5);

  return selectedShiftIds.map(id => {
    const updateType = updateTypes[Math.floor(Math.random() * updateTypes.length)];
    return updateType(id);
  });
}

export default function () {
  // Get VU-specific batch counter
  let batchCount = batchesPerVU.get(__VU) || 0;
  
  if (batchCount >= BATCHES_PER_USER) {
    sleep(1);
    return;
  }

  // Process in groups of 5 concurrent batches
  const remainingBatches = BATCHES_PER_USER - batchCount;
  const batchesInThisGroup = Math.min(CONCURRENT_BATCHES, remainingBatches);
  
  console.log(`VU ${__VU}: Processing batches ${batchCount + 1} to ${batchCount + batchesInThisGroup} of ${BATCHES_PER_USER}`);

  const requests = [];
  for (let i = 0; i < batchesInThisGroup; i++) {
    const currentBatch = batchCount + i;
    const payload = JSON.stringify({
      shifts: generateBatchUpdates(currentBatch, __VU)
    });

    requests.push({
      method: 'PATCH',
      url: __ENV.API_URL + '/api/v1/shifts/batch/update',
      body: payload,
      params: {
        headers: {
          'x-api-key': API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'k6-enterprise-test',
        },
        timeout: '30s',
      },
    });
  }

  const responses = http.batch(requests);
  
  // Process responses
  responses.forEach((response, index) => {
    if (response.status !== 200) {
      errorRate.add(1);
      console.log(`VU ${__VU} Error in batch ${batchCount + index + 1}: Status ${response.status}`);
    }

    if (response.timings.duration > 3000) {
      slowResponseRate.add(1);
    }

    check(response, {
      'is status 200': (r) => r.status === 200,
      'response time < 3000ms': (r) => r.timings.duration < 3000,
      'batch update successful': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body && body.success === true;
        } catch (e) {
          return false;
        }
      },
    });
  });

  // Update batch counter
  batchesPerVU.set(__VU, batchCount + batchesInThisGroup);
  
  // Add delay between batch groups (enterprise tier gets shorter delay)
  sleep(1); // 1s delay between groups of 5
} 
