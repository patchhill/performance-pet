const fs = require('fs').promises;

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error('API_KEY environment variable is not set');
}

const JOB_ID = 'cm64ly8v3000013gvb9ceypch';
const SHIFTS_PER_PAGE = 50;

async function fetchShiftIds() {
  const shiftIds = [];
  let page = 1;
  let totalPages = Infinity;
  
  console.log('Starting to fetch shift IDs...');

  while (page <= totalPages && shiftIds.length < 6500) {
    const url = __ENV.API_URL + `/api/v1/shifts?page=${page}&sortOrder=desc&jobId=${JOB_ID}&pageSize=${SHIFTS_PER_PAGE}`;
    
    try {
      const response = await fetch(url, {
        headers: {
          'x-api-key': API_KEY,
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        
        if (page === 1) {
          totalPages = data.meta.totalPages;
          console.log(`Total pages available: ${totalPages}`);
        }
        
        const pageShiftIds = data.data.map(shift => shift.id);
        shiftIds.push(...pageShiftIds);
        
        console.log(`Retrieved ${pageShiftIds.length} shifts from page ${page}`);
        
        page++;
        
        // Add delay between requests
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.error(`Error fetching page ${page}: ${response.status}`);
        break;
      }
    } catch (error) {
      console.error(`Failed to fetch page ${page}:`, error);
      break;
    }
  }

  console.log(`\nFetch complete! Total shift IDs collected: ${shiftIds.length}`);
  
  // Save to file
  await fs.writeFile('shift-ids.json', JSON.stringify({ shiftIds }, null, 2));
  console.log('Saved shift IDs to shift-ids.json');
}

fetchShiftIds().catch(console.error); 