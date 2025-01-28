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
    single_user_bulk_delete: {
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

let batchCounter = 0;
const SHIFTS_PER_BATCH = 100;
const TOTAL_BATCHES = Math.ceil(shiftIds.length / SHIFTS_PER_BATCH);

export default function () {
  if (batchCounter >= TOTAL_BATCHES) {
    console.log(`All ${shiftIds.length} shifts have been queued for deletion`);
    return;
  }

  const currentBatch = batchCounter++;
  const startIdx = currentBatch * SHIFTS_PER_BATCH;
  const batchShiftIds = shiftIds.slice(startIdx, startIdx + SHIFTS_PER_BATCH);
  
  const url = __ENV.API_URL + '/api/v1/shifts/batch/delete';
  const payload = JSON.stringify({
    shiftIds: batchShiftIds
  });
  
  const headers = {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'k6-test',
  };

  console.log(`Sending delete batch ${currentBatch + 1} of ${TOTAL_BATCHES} (${batchShiftIds.length} shifts)`);

  try {
    const response = http.del(url, payload, { 
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
      'batch deletion successful': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body && body.success === true;
        } catch (e) {
          console.log(`JSON parse error in batch ${currentBatch + 1}:`, e);
          return false;
        }
      },
    });

    // Add a small delay between batches to prevent overwhelming the system
    sleep(1);

  } catch (error) {
    console.error(`Request failed for batch ${currentBatch + 1}:`, error);
    errorRate.add(1);
  }
}