
{/*
  
Concurrency Breakdown
1. **Initial Stage (0-2min)**
   - Starts: 5 requests/min
   - Ends: 8 requests/min
   - ~13 requests in this stage

2. **Peak Stage (2-4min)**
   - Starts: 8 requests/min
   - Ends: 10 requests/min
   - ~18 requests in this stage

3. **Cool Down (4-5min)**
   - Starts: 10 requests/min
   - Ends: 5 requests/min
   - ~7-8 requests in this stage

### Total Requests
- Duration: 5 minutes
- Approximately 38-40 total requests
- Each request contains either 25 or 50 shifts
- Total shifts processed: ~1,000-2,000

### Concurrent Users
- `preAllocatedVUs: 5`
- `maxVUs: 15`
- System starts with 5 virtual users
- Can scale up to 15 if needed to maintain request rate
- Not truly concurrent as k6 enforces the rate limit (6s sleep between requests)

### Rate Limiting
- 6-second sleep between requests
- Maximum theoretical throughput: 10 requests per minute
- Test stays within this limit even at peak (10 req/min)*/}



import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { shiftIds } from '../../../shift-ids.js';

const slowResponseRate = new Rate('slow_responses');
const errorRate = new Rate('error_rate');
const batchSizeTrend = new Trend('batch_size_impact');

const API_KEY = __ENV.API_KEY;
if (!API_KEY) {
  throw new Error('API_KEY environment variable is not set');
}

export const options = {
  scenarios: {
    batch_size_test: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1m',
      preAllocatedVUs: 5,
      maxVUs: 15,
      stages: [
        { duration: '2m', target: 8 },   // Normal load
        { duration: '2m', target: 10 },  // Peak load
        { duration: '1m', target: 5 },   // Cool down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<3000', 'avg<1500'],
    'slow_responses': ['rate<0.1'],
    'error_rate': ['rate<0.01'],
  },
};

function generateComplexUpdates(count) {
  const updateScenarios = [
    // Scenario 1: Full update
    (id) => ({
      id,
      startTime: "09:00",
      endTime: "18:00",
      jobId: "clxwtgfi30002dq4qppn6iw8h",
      status: "available",
      rate: 200,
      cost: 299,
      metadata: {
        check: "system-shifts-test",
        updateType: "full"
      },
      tags: [{ name: "Testing40" }]
    }),
    // Scenario 2: Minimal update
    (id) => ({
      id,
      status: "confirmed",
      metadata: { updateType: "status-only" }
    }),
    // Scenario 3: Medium update
    (id) => ({
      id,
      startTime: "10:00",
      endTime: "19:00",
      rate: 225,
      cost: 325,
      metadata: { updateType: "time-cost" }
    })
  ];

  const selectedShiftIds = [...shiftIds]
    .sort(() => Math.random() - 0.5)
    .slice(0, count);

  return selectedShiftIds.map(id => {
    const scenario = updateScenarios[Math.floor(Math.random() * updateScenarios.length)];
    const update = scenario(id);
    return update;
  });
}

export default function () {
  // Alternate between batch sizes of 25 and 50
  const url = __ENV.API_URL + '/api/v1/shifts/batch/update';
  const batchSize = Math.random() < 0.5 ? 25 : 50;
  
  const payload = JSON.stringify({
    shifts: generateComplexUpdates(batchSize)
  });
  
  const headers = {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'k6-test',
  };

  try {
    const startTime = new Date();
    const response = http.patch(url, payload, { 
      headers,
      timeout: '30s',
      throw_on_error: false,
    });

    // Record metrics with batch size context
    batchSizeTrend.add(response.timings.duration, { batchSize: batchSize });

    if (response.status !== 200) {
      errorRate.add(1);
      console.log(`Error - Batch Size: ${batchSize}, Duration: ${response.timings.duration}ms`);
      console.log(`Response Body: ${response.body}`);
    }

    if (response.timings.duration > 2000) {
      slowResponseRate.add(1);
      console.log(`Slow Request - Batch Size: ${batchSize}, Duration: ${response.timings.duration}ms`);
    }

    check(response, {
      'is status 200': (r) => r.status === 200,
      'response time < 2000ms': (r) => r.timings.duration < 2000,
      'batch update successful': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body && body.success === true;
        } catch (e) {
          return false;
        }
      },
      'correct batch size processed': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.data && body.data.length === batchSize;
        } catch (e) {
          return false;
        }
      }
    });

    sleep(6);

  } catch (error) {
    console.error('Request failed:', error);
    errorRate.add(1);
  }
}

{/* 
  ### Test Results Summary
- Total Requests: 38 ✅
- Success Rate: 100% (0 failures)
- Peak RPS: 0.33 requests/second

### Performance Metrics
- Min: 618ms
- Average: 1s
- StdDev: 308ms
- P95: 1.382s
- P99: 2s
- Max: 2s

### Test Execution Analysis
1. Request Volume
   - Achieved expected ~38 requests (matches our planned 38-40)
   - Perfect success rate (0 HTTP failures)
   - Maintained rate limit compliance (0.33 RPS = ~20 requests/minute)

2. Performance
   - Faster minimum response time (618ms vs 824ms in baseline)
   - Similar average (1s)
   - Slightly better P95 (1.382s vs 2s in baseline)
   - More consistent performance (StdDev: 308ms vs 331ms in baseline)

3. Load Pattern Effectiveness
   - Successfully executed ramping pattern
   - Initial stage: ~13 requests
   - Peak stage: ~18 requests
   - Cool down: ~7 requests
   - Total: 38 requests ✅


   ### Batch Size Performance Analysis

    #### 25-Shift Batches
    - Typical Range: 600-800ms
    - More consistent performance
    - Lower resource utilization
    - Ideal for time-sensitive operations

    #### 50-Shift Batches
    - Typical Range: 1000-1382ms
    - Higher variance in response times
    - Better throughput per request but longer wait times

  ### Recommendations
  1. For Time-Sensitive Operations
    - Use 25-shift batches
    - More predictable performance
    - Better for real-time updates

  2. For Bulk Operations
    - 50-shift batches are still efficient
    - Good for background/scheduled updates
    - Higher total throughput when time isn't critical
  */}