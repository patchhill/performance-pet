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
const BATCHES_PER_USER = 3; // Each user updates 900 shifts (3 batches of 100 × 3 regions)

// VU 1: 3 batches × 3 instances (sydney, tokyo, singapore) = 900 shifts

function generateBatchUpdates(batchCount, vuId) {
  const batchSize = 100;
  // Calculate starting index based on VU ID and batch count
  // Each VU gets its own unique range of 300 shifts (3 batches × 100 shifts)
  const vuStartIndex = (vuId - 1) * 300; // VU1 starts at 0, VU2 at 300, VU3 at 600, etc.
  const startIdx = vuStartIndex + (batchCount * batchSize);
  const batchShiftIds = shiftIds.slice(startIdx, startIdx + batchSize);

  const possibleUpdates = [
    (id) => ({
      id,
      status: 'confirmed',
      metadata: {
        updateSource: `vu-${vuId}-concurrent-test`,
        updateType: 'status-update',
        batchId: `batch-${batchCount}-${Date.now()}`
      }
    }),
    (id) => ({
      id,
      rate: Math.floor(Math.random() * (45 - 25) + 25),
      cost: Math.floor(Math.random() * (400 - 300) + 300),
      metadata: {
        updateSource: `vu-${vuId}-concurrent-test`,
        updateType: 'rate-update',
        batchId: `batch-${batchCount}-${Date.now()}`
      }
    }),
    (id) => ({
        id,
        bookCandidateId: "clxievkz500001em2gyoswdwq",
        metadata: {
          check: "system-shifts-test",
          updateType: "booking"
        }
      }),
      (id) => ({
        id,
        startTime: '11:00',
        endTime: '20:00',
        customFields: [
          {
            fieldId: "cm5xeds9v0000au5l69m1c0ra",
            value: `Updated Value ${Date.now()}`
          }
        ],
        metadata: {
          updateSource: `vu-${vuId}-concurrent-test`,
          updateType: 'custom-field-update',
          batchId: `batch-${batchCount}-${Date.now()}`
        }
      }),
    (id) => ({
      id,
      startTime: '10:00',
      endTime: '18:00',
      tags: [
        {
          name: "Testing100"
        }
      ],
      metadata: {
        updateSource: `vu-${vuId}-concurrent-test`,
        updateType: 'time-update',
        batchId: `batch-${batchCount}-${Date.now()}`
      }
    })
  ];

  return batchShiftIds.map(id => {
    const updateType = possibleUpdates[Math.floor(Math.random() * possibleUpdates.length)];
    return updateType(id);
  });
}

export default function () {
  // Get VU-specific batch counter
  let batchCount = batchesPerVU.get(__VU) || 0;
  
  if (batchCount >= BATCHES_PER_USER) {
    sleep(1); // Keep VU active but idle after processing 900 shifts (300 per region)
    return;
  }

  const url = __ENV.API_URL + '/api/v1/shifts/batch/update';
  const payload = JSON.stringify({
    shifts: generateBatchUpdates(batchCount, __VU)
  });
  
  const headers = {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'k6-test',
  };

  console.log(`VU ${__VU}: Sending batch ${batchCount + 1} of ${BATCHES_PER_USER}`);

  try {
    const response = http.patch(url, payload, { 
      headers,
      timeout: '30s',
      throw_on_error: false,
    });

    if (response.status !== 200) {
      errorRate.add(1);
      console.log(`VU ${__VU} Error in batch ${batchCount + 1}: Status ${response.status}`);
    }

    if (response.timings.duration > 2500) {
      slowResponseRate.add(1);
    }

    check(response, {
      'is status 200': (r) => r.status === 200,
      'response time < 2500ms': (r) => r.timings.duration < 2500,
      'batch update successful': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body && body.success === true;
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


{/* 
    
    API Endpoint Performance (/api/v1/shifts/batch/update):
    Request Statistics:
        Total Requests: 30
        Success Rate: 100% (0 failures)
        Peak RPS: 1 request/second
    
    Response Times:
        Average: 1,295ms
        P95: 2,118ms
        P99: 2,346ms
        Range: 418ms - 2,000ms
    
    Status Codes:
        200 OK: 30 requests (100%)
    
    Thresholds:
        ✓ Average < 2,500ms (actual: 1,295ms)
        ✓ P95 < 4,000ms (actual: 2,118ms)
        ✓ P99 < 5,000ms (actual: 2,346ms)
        ✓ Error Rate < 1% (actual: 0%)
    
    Load Test Results:
        - All thresholds met
        - Consistent response times
        - No failed requests
        - Stable under concurrent load

    Performance Summary - (/api/v1/shifts/batch/process):
    Total Shifts Updated: 3,000
    Total QStash Requests: 120
    Batch Size: 25 shifts per QStash request
    
    Duration:
        Start: 11:11:27
        End: 11:13:30
        Total: ~2 minutes
    
    Processing Times:
        Average: ~1200ms
        Fastest: 803ms
        Slowest: 1935ms
        Normal Range: 1000-1800ms
    
    Error Handling:
        - 1 failed request (500)
        - QStash auto-retry successful
        - Overall success rate: 100%
    
    Observations:
        1. Stable processing times under concurrent load
        2. Effective queue management by QStash
        3. Good error recovery with retry mechanism
        4. Consistent throughput across regions
        
    Recommendations:
        1. Current batch size (25) is optimal
        2. QStash retry mechanism working as expected
        3. System handles concurrent updates efficiently
        4. Processing times remain stable under load
*/}