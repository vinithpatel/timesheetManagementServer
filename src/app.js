const express = require("express") ;
const bodyParser = require("body-parser") ;
const cors = require("cors") ;
const path = require("path") ;

const {open} = require("sqlite") ;
const sqlite3 = require("sqlite3") ;

const {startOfWeek, endOfWeek, format, getDay, nextMonday, previousSunday, getWeek} = require("date-fns") ;


const app = express() ;

app.use(bodyParser.json()) ;
app.use(cors()) ;


let db = null ;
const dbPath = path.join(__dirname, "TimeSheetManagement.db") 

const initilizeDBAndStartServer = async () => {
    try{
        db = await open({
            filename:dbPath,
            driver:sqlite3.Database,
        });

        app.listen(8001, () => {
            console.log("Server Runnig at 8001 PORT") ;
        })
    }
    catch(error){
        console.log(error) ;
        process.exit(1) ;
    }
}


initilizeDBAndStartServer() ;

app.post("/login", async (request, response) => {
    const {employeeId, password} = request.body 

    const selectEmployeeQuery = `
        SELECT id AS employeeId, name AS employeeName, password, email, is_admin AS isAdmin
        FROM EMPLOYEE
        WHERE id LIKE '%${employeeId}%' ;
    ` 

    const employee = await db.get(selectEmployeeQuery) ;


    if(employee === undefined){
        response.status(400) ;
        response.send({text:'Invalid User'}) ;
    }else if(employee.password !== password){
        
        response.status(400) ;
        response.send({text:"Invalid Password"}) ;
    }
    else{
        response.send({
            employeeId:employee.employeeId,
            employeeName:employee.employeeName,
            email:employee.email, 
            isAdmin: employee.isAdmin === 0 ? false : true ,
        }) ;  
    }
}) ;


app.get("/projects/:employeeId", async (request, response) => {
    const {employeeId} = request.params ;

    const selectProjectsQuery = `
            SELECT PROJECT.id AS projectId, PROJECT.project_name AS projectName
            FROM EMPLOYEE_PROJECT JOIN PROJECT ON EMPLOYEE_PROJECT.project_id = PROJECT.id
            WHERE EMPLOYEE_PROJECT.employee_id = ${employeeId} ;
    `;

    try{
        const data = await db.all(selectProjectsQuery) ;
        response.send(data) ;
    }catch(error){
        console.log(error) ;
    }
});

app.get('/timesheets', async (request, response) => {

    let {timesheet_id = "",employee_id="",employee_name="",log_hours="", start_date, end_date,status=""} = request.query;   
    
    
    const selectTimeSheetsQuery = `
    SELECT TIMESHEET.id AS timeSheetId, TIMESHEET.employee_id AS employeeId , EMPLOYEE.name AS employeeName , TIMESHEET.week AS week, TIMESHEET.status AS status, TIMESHEET.start_date AS startDate,TIMESHEET.end_date AS endDate, SUM(COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(thursday, 0)+COALESCE(friday, 0)+COALESCE(wednesday, 0)+COALESCE(satuarday, 0) +COALESCE(sunday, 0)) AS logHours 
    FROM TIMESHEET JOIN TIMESHEET_PROJECT 
        ON TIMESHEET.id = TIMESHEET_PROJECT.timesheet_id JOIN EMPLOYEE ON TIMESHEET.employee_Id = EMPLOYEE.id  
    WHERE TIMESHEET.id LIKE '%${timesheet_id}%' 
            AND TIMESHEET.start_date >= '${start_date}' 
            AND TIMESHEET.end_date <= '${end_date}'
            AND EMPLOYEE.id LIKE '%${employee_id}%' 
            AND EMPLOYEE.name LIKE '%${employee_name}%'
            AND TIMESHEET.status LIKE '%${status}%'
    GROUP BY timesheet_id
    HAVING logHours LIKE '%${log_hours}%' ;
    `

    const data = await db.all(selectTimeSheetsQuery) ;
    response.send(data)

})


app.get('/timesheet/employee/:employee_id', async(request, response) => {
    const {start_date, end_date} = request.query 
    const {employee_id} = request.params
    
    const selectTimeSheetQuery = `
        SELECT id AS timeSheetId, week, status, start_date AS startDate, end_date AS endDate
        FROM TIMESHEET 
        WHERE employee_id=${employee_id} AND start_date = '${start_date}' AND end_date = '${end_date}' ;
    `

    const data = await db.get(selectTimeSheetQuery) ;
    
    response.send({data}) ;
   
})

app.post("/timesheet/create", async (request, response) => {
    const {employeeId, week, startDate, endDate} = request.body ;

    const selectTimeSheetQuery = `
        SELECT *
        FROM TIMESHEET
        WHERE employee_id = '${employeeId}' 
        AND start_date = '${startDate}' 
        AND end_date = '${endDate}' 
        AND week = '${week}' ;
    `

    const dbData = await db.get(selectTimeSheetQuery) ;
    
    if(dbData !== undefined){
        response.status(409) ;
        response.send({msg:"Invalid request data. The timesheet entry already exists."})
    }
    else{
        const insertSheetQuery = `
            INSERT INTO TIMESHEET(
                employee_id, week, start_date, end_date, status
            )
            VALUES(
                ${employeeId}, '${week}', '${startDate}', '${endDate}', 'open'
            )
        `

        const dbResponse = await db.run(insertSheetQuery)
        response.send({timeSheetId:dbResponse.lastID}) ; 
    }
       
})


// app.get('/timesheet/employee/:employee_id', async(request, response) => {
//     const {start_date, end_date} = request.query 
//     const {employee_id} = request.params
    
//     const selectTimeSheetQuery = `
//         SELECT TIMESHEET_PROJECT.id AS id, TIMESHEET.id AS timeSheetId, TIMESHEET.status AS status, TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName, monday, tuesday, wednesday, thursday, friday, satuarday, sunday, total, comment
//         FROM TIMESHEET JOIN TIMESHEET_PROJECT ON TIMESHEET.id = TIMESHEET_PROJECT.timesheet_id JOIN PROJECT ON PROJECT.id = TIMESHEET_PROJECT.project_id
//         WHERE TIMESHEET.employee_id=${employee_id} AND TIMESHEET.start_date = '${start_date}' AND TIMESHEET.end_date = '${end_date}' ;
//     `

//     const data = await db.all(selectTimeSheetQuery) ;
    
//     response.send(data) ;
   
// })

app.get('/timesheet/:timeSheetId', async (request, response) => {
    const {timeSheetId} = request.params ;

    const selectTimeSheetQuery = `
    SELECT TIMESHEET_PROJECT.id AS id, TIMESHEET.id AS timeSheetId, TIMESHEET.status AS status, TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName, 
        monday, tuesday, wednesday, thursday, friday, satuarday, 
        sunday, comment,(COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) AS total

    FROM TIMESHEET JOIN TIMESHEET_PROJECT ON TIMESHEET.id = TIMESHEET_PROJECT.timesheet_id JOIN PROJECT ON PROJECT.id = TIMESHEET_PROJECT.project_id
    WHERE TIMESHEET.id=${timeSheetId} ;

    `

    const data = await db.all(selectTimeSheetQuery)
    response.send(data) ;
})



app.put("/timesheet/submit/:timeSheetId", async (request, response) => {
    const {timeSheetId} = request.params ;

    const submitTimeSheetQuery =`
        UPDATE TIMESHEET
        SET status='submited'
        WHERE id = ${timeSheetId} ;
    `

    await db.run(submitTimeSheetQuery)

    response.send({text:"Timesheet Submited Sucessfull"}) ;
})

app.put("/timesheet/save/:timeSheetId", async (request, response) => {
    
    const {timeSheetId} = request.params ;
    const {arr} = request.body ;
    
    const deleteOldTimeSheetProjectsQuery = `
        DELETE FROM TIMESHEET_PROJECT
        WHERE timesheet_id = ${timeSheetId}
    `

    await db.run(deleteOldTimeSheetProjectsQuery) ;

    for(const row of arr){
        const insertTimeSheetProjectsQuery = `
            INSERT INTO TIMESHEET_PROJECT(
                timesheet_id, project_id, monday, tuesday, wednesday, thursday, friday, satuarday, sunday, comment
            )
            VALUES(
                ${timeSheetId}, ${row.projectId}, ${row.monday}, ${row.tuesday}, ${row.wednesday}, ${row.thursday}, ${row.friday}, ${row.satuarday}, ${row.sunday}, '${row.comment}'
            ) ;
        `
        await db.run(insertTimeSheetProjectsQuery) ; 
    }

    response.send({text:"projects data updated sucessfully"});
    
})


app.put('/timesheet/approve/:timeSheetId', async (request, response) => {
    const {timeSheetId} = request.params ;

    const approveTimeSheetQuery = `
        UPDATE TIMESHEET
        SET status = 'approved'
        WHERE id = ${timeSheetId} ;
    `

    const dbResponse = await db.run(approveTimeSheetQuery) ;

    response.send(dbResponse) ;

})

app.put('/timesheet/deny/:timeSheetId', async (request, response) => {
    const {timeSheetId} = request.params ;

    const denieTimeSheetQuery = `
        UPDATE TIMESHEET
        SET status = 'denied'
        WHERE id = ${timeSheetId} ;
    `

    const dbResponse = await db.run(denieTimeSheetQuery) ;

    response.send(dbResponse) ;

})

app.put('/timesheet/open/:timeSheetId', async (request, response) => {
    const {timeSheetId} = request.params ;

    const openTimeSheetQuery = `
        UPDATE TIMESHEET
        SET status = 'open'
        WHERE id = ${timeSheetId} ;
    `

    const dbResponse = await db.run(openTimeSheetQuery) ;

    response.send(dbResponse) ;

})


app.get('/timesheet/export/:timeSheetId', async(request, response) => {
        const {timeSheetId} = request.params 
        
        const selectTimeSheetQuery = `
        SELECT TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName,
        (COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) AS total, 
        ((COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) * Rate.rate/8) AS cost, Rate.rate

        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id JOIN TIMESHEET_PROJECT ON TIMESHEET_PROJECT.timesheet_id = TIMESHEET.id JOIN PROJECT ON project.id = TIMESHEET_PROJECT.project_id JOIN RATE ON (RATE.position_id = EMPLOYEE.position_id AND RATE.project_id = TIMESHEET_PROJECT.project_id)
        WHERE TIMESHEET.id=${timeSheetId} ;
        `

        const data = await db.all(selectTimeSheetQuery)
        response.send(data) ;
});

app.get('/timesheet/employee/:employeeId/monthly_export/:monthValue', async (request, response) => {

    const {employeeId, monthValue} = request.params;

    const [year, month] = monthValue.split("-") ;

    const date = new Date(year, month-1, 1)
    
    const firstWeekNumber = getWeek(date, {weekStartsOn:1, firstWeekContainsDate:2})
    const firstWeekNumberFormat = `${year}-W${firstWeekNumber}`

    const monthSecondWeekDate = nextMonday(date) ;
    const secondWeekFirstDayFormat = format(monthSecondWeekDate, 'yyyy-MM-dd') ;


    const columnNames = ['COALESCE(monday,0)', 'COALESCE(tuesday,0)','COALESCE(wednesday,0)' , 'COALESCE(thursday,0)', 'COALESCE(friday,0)', 'COALESCE(satuarday, 0)', 'COALESCE(sunday, 0)'] ;

    let dayOfWeek = getDay(date) ;

    if(dayOfWeek === 0){
        dayOfWeek = 6 ;
    }else{
        dayOfWeek -= 1
    }
    const firstWeekColumnNames = columnNames.slice(dayOfWeek).join('+');


    date.setMonth(date.getMonth() + 1) ;
    date.setDate(0) ;

    const monthEndWeekNumber = getWeek(date, {weekStartsOn:1, firstWeekContainsDate:2})
    const endWeekNumberFormat = `${year}-W${monthEndWeekNumber}`

    const monthEndPreviousWeekDate = previousSunday(date) ;
    const monthEndtPreviousWeekFormat = format(monthEndPreviousWeekDate, 'yyyy-MM-dd') ;

    dayOfWeek = getDay(date) ;

    if(dayOfWeek === 0){
        dayOfWeek = 7 ;
    }

    const lastWeekColumnNames = columnNames.slice(0, dayOfWeek).join('+') ;

    // console.log(firstWeekNumberFormat)
    // console.log(secondWeekFirstDayFormat)
    // console.log(firstWeekColumnNames)

    // console.log(endWeekNumberFormat)
    // console.log(monthEndtPreviousWeekFormat)
    // console.log(lastWeekColumnNames)

    const firstWeekSelectQuery = `
        SELECT TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName,
        SUM(${firstWeekColumnNames}) AS total,
        SUM((${firstWeekColumnNames}) * RATE.rate/8) AS cost
        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id JOIN TIMESHEET_PROJECT ON TIMESHEET_PROJECT.timesheet_id = TIMESHEET.id JOIN PROJECT ON PROJECT.id = TIMESHEET_PROJECT.project_id JOIN RATE ON (RATE.position_id = EMPLOYEE.position_id AND RATE.project_id = TIMESHEET_PROJECT.project_id)
        WHERE TIMESHEET.week LIKE '%${firstWeekNumberFormat}%' AND TIMESHEET.employee_id LIKE '%${employeeId}%'
        GROUP BY projectId 
    `

    const lastWeekSelectQuery = `
        SELECT TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName,
        SUM(${lastWeekColumnNames}) AS total,
        SUM((${lastWeekColumnNames}) * RATE.rate/8) AS cost
        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id JOIN TIMESHEET_PROJECT ON TIMESHEET_PROJECT.timesheet_id = TIMESHEET.id JOIN PROJECT ON PROJECT.id = TIMESHEET_PROJECT.project_id JOIN RATE ON (RATE.position_id = EMPLOYEE.position_id AND RATE.project_id = TIMESHEET_PROJECT.project_id)
        WHERE TIMESHEET.week LIKE '%${endWeekNumberFormat}%' AND TIMESHEET.employee_id LIKE '%${employeeId}%'
        GROUP BY projectId 
    `

    const middleWeeksSelectQuery = `
        SELECT TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName,
        SUM(COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) AS total, 
        SUM((COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) * Rate.rate/8) AS cost

        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id JOIN TIMESHEET_PROJECT ON TIMESHEET_PROJECT.timesheet_id = TIMESHEET.id JOIN PROJECT ON project.id = TIMESHEET_PROJECT.project_id JOIN RATE ON (RATE.position_id = EMPLOYEE.position_id AND RATE.project_id = TIMESHEET_PROJECT.project_id)
        WHERE TIMESHEET.id IN (SELECT TIMESHEET.id AS id 
            FROM TIMESHEET
            WHERE TIMESHEET.employee_id LIKE '%${employeeId}%' AND TIMESHEET.start_date >= '${secondWeekFirstDayFormat}' AND TIMESHEET.end_date <= '${monthEndtPreviousWeekFormat}')
        GROUP BY projectId 
    `

    const selectMonthQuery = `
            WITH FirstWeek AS (
                ${firstWeekSelectQuery}
            ),
            MiddleWeek AS (
                ${middleWeeksSelectQuery}
            ),
            LastWeek AS (
                ${lastWeekSelectQuery}
            )
            SELECT projectId, projectName, SUM(total) AS total, SUM(cost) AS cost
            FROM (
                SELECT * FROM FirstWeek
                UNION ALL
                SELECT * FROM MiddleWeek
                UNION ALL
                SELECT * FROM LastWeek
            ) AS CombineQuery
            GROUP BY projectId ;
    `

    const data = await db.all(selectMonthQuery)
    response.send(data) ;

})

app.get('/timesheet/employee/:employeeId/weekly_export/:weekValue', async (request, response) => {
    const {employeeId,  weekValue} = request.params ;
    console.log(employeeId)
    console.log(weekValue)
    
    const selectTimeSheetQuery = `
        SELECT TIMESHEET_PROJECT.project_id AS projectId, PROJECT.project_name AS projectName,
        (COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) AS total, 
        ((COALESCE(monday,0)+COALESCE(tuesday,0)+COALESCE(wednesday,0)+COALESCE(thursday,0)+COALESCE(friday,0)+COALESCE(satuarday,0)+COALESCE(sunday,0)) * Rate.rate/8) AS cost, Rate.rate

        FROM TIMESHEET JOIN EMPLOYEE ON EMPLOYEE.id = TIMESHEET.employee_id JOIN TIMESHEET_PROJECT ON TIMESHEET_PROJECT.timesheet_id = TIMESHEET.id JOIN PROJECT ON project.id = TIMESHEET_PROJECT.project_id JOIN RATE ON (RATE.position_id = EMPLOYEE.position_id AND RATE.project_id = TIMESHEET_PROJECT.project_id)
        WHERE TIMESHEET.employee_id LIKE '%${employeeId}%' AND TIMESHEET.week LIKE '%${weekValue}%' ;
        `

    const data = await db.all(selectTimeSheetQuery)
    response.send(data) ;
    
})

app.get("/employee/:employeeId", async (request, response) => {
    const {employeeId} = request.params ;

    const selectEmployeeQuery = `
        SELECT EMPLOYEE.id AS employeeId, name AS employeeName, email AS employeeEmail, is_admin AS isAdmin , POSITION.position_name AS position
        FROM EMPLOYEE JOIN POSITION ON EMPLOYEE.position_id = POSITION.id
        WHERE EMPLOYEE.id = '${employeeId}' ;
    `

    const dbData = await db.get(selectEmployeeQuery)
    
    if(dbData === undefined){
        response.status(404)
        response.send({msg:"Employee Id Not Found"})
    }else{
        response.send(dbData) ;
    }
})