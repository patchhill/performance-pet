import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { shiftIds } from '../../../shift-ids.js';

const slowResponseRate = new Rate('slow_responses');
const errorRate = new Rate('error_rate');

const API_KEY = __ENV.API_KEY;
if (!API_KEY) {
  throw new Error('API_KEY environment variable is not set');
}

export const options = {
  scenarios: {
    batch_updates: {
      executor: 'constant-arrival-rate',
      rate: 10, // 10 batch requests per minute (matches rate limit)
      timeUnit: '1m',
      duration: '5m',
      preAllocatedVUs: 5,
      maxVUs: 10,
    },
  },
  thresholds: {
    http_req_duration: [
      'p(95)<2000', // 95% of requests under 2s (batch operations take longer)
      'p(99)<3000', // 99% under 3s
      'avg<1000',   // Average under 1s
    ],
    http_req_failed: ['rate<0.01'], // Less than 1% error rate
  },
  ext: {
    loadimpact: {
      distribution: {
        'amazon:au:sydney': { loadZone: 'amazon:au:sydney', percent: 100 },
      },
    },
  },
};

function generateBatchShifts(count = 50) {
  const possibleUpdates = [
    (id) => ({ id, status: 'confirmed' }),
    (id) => ({ id, rate: Math.floor(Math.random() * (45 - 25) + 25) }),
    (id) => ({
      id,
      bookCandidateId: "clxievkz500001em2gyoswdwq",
      customFields: [
        {
          fieldId: "cm5xeds9v0000au5l69m1c0ra",
          value: `Updated Info ${Date.now()}`
        }
      ]
    })
  ];

  // Take a random subset of shift IDs for each batch
  const selectedShiftIds = [...shiftIds]
    .sort(() => Math.random() - 0.5)
    .slice(0, count);

  return selectedShiftIds.map(id => {
    const updateType = possibleUpdates[Math.floor(Math.random() * possibleUpdates.length)];
    return updateType(id);
  });
}

export default function () {
  const url = __ENV.API_URL + '/api/v1/shifts/batch/update';
  const payload = JSON.stringify({
    shifts: generateBatchShifts()
  });
  
  const headers = {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'k6-test',
  };

  try {
    const response = http.patch(url, payload, { 
      headers,
      timeout: '30s',
      throw_on_error: false,
    });

    if (response.status !== 200) {
      errorRate.add(1);
      console.log(`Error response: Status ${response.status}, Body: ${response.body}`);
    }

    if (response.timings.duration > 2000) {
      slowResponseRate.add(1);
      console.log(`Slow batch update: ${response.timings.duration}ms`);
    }

    check(response, {
      'is status 200': (r) => r.status === 200,
      'response time < 2000ms': (r) => r.timings.duration < 2000,
      'batch update successful': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body && body.success === true;
        } catch (e) {
          console.log('JSON parse error:', e);
          return false;
        }
      },
    });

    // Sleep between requests to respect rate limit
    // 60s / 10 requests = 6s minimum between requests
    sleep(6);

  } catch (error) {
    console.error('Request failed:', error);
    errorRate.add(1);
  }
} 

{/* 
📊 Batch Update Performance Summary

### Test Results
- Status: 200 ✅ (All requests successful)
- Count: 51 batch requests
- Min: 476ms
- Average: 587ms
- StdDev: 68ms
- P95: 700ms
- P99: 729ms
- Max: 750ms

### Key Insights
1. Reliability ✅
   - 100% success rate (all 200 status codes)
   - No failed requests
   - Very consistent performance (low StdDev)

2. Performance Metrics
   - Most requests complete between 476ms - 750ms
   - 95% of requests complete under 700ms
   - Very tight performance band (only 274ms between min and max)
   - Low standard deviation (68ms) indicates excellent consistency

3. Rate Limit Compliance
   - Successfully handling 51 requests
   - Well within the 10 requests per minute limit
   - No rate limit violations observed

🎯 Thresholds Status:
- ✅ P95 < 2000ms (Actual: 700ms)
- ✅ P99 < 3000ms (Actual: 729ms)
- ✅ Average < 1000ms (Actual: 587ms)
- ✅ Error rate < 1% (Actual: 0%)

Overall: Excellent performance with high consistency and reliability. The system is handling batch updates well within defined thresholds.
  */}