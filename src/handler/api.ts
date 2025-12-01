import { DataCache } from "../database/cache";
import { MachineStateTable } from "../database/table";
import { IdentityProviderClient } from "../external/idp";
import { SmartMachineClient } from "../external/smart-machine";
import { GetMachineRequestModel, HttpResponseCode, MachineResponseModel, RequestMachineRequestModel, RequestModel, StartMachineRequestModel } from "./model";
import { MachineStateDocument, MachineStatus } from "../database/schema";
/**
 * Handles API requests for machine operations.
 * This class is responsible for routing requests to the appropriate handlers
 * and managing the overall workflow of machine interactions.
 */
export class ApiHandler {
    private cache: DataCache<MachineStateDocument>;
    constructor() {
        this.cache = DataCache.getInstance<MachineStateDocument>();
    }

    /**
     * Validates an authentication token.
     * @param token The token to validate.
     * @throws An error if the token is invalid.
     */
    private checkToken(token: string) {
        // Your implementation here
        const client = IdentityProviderClient.getInstance();
        const valid = client.validateToken(token);

        if(!valid)
            {
                throw "{\"statusCode\":401,\"message\":\"Invalid token\"}";
            }
        return true;
    }

    /**
     * Handles a request to find and reserve an available machine at a specific location.
     * It finds an available machine, updates its status to AWAITING_DROPOFF,
     * assigns the job ID, and caches the updated machine state.
     * NOTE: The current implementation assumes a machine will be held for a certain period,
     * but there is no mechanism to release the hold if the user doesn't proceed.
     * @param request The request model containing location and job IDs.
     * @returns A response model with the status code and the reserved machine's state.
     */
    private handleRequestMachine(request: RequestMachineRequestModel): MachineResponseModel {
        // Your implementation here

        const db = MachineStateTable.getInstance();
        const cache = DataCache.getInstance();
        const local_devices = db.listMachinesAtLocation(request.locationId);
        const machine = local_devices.find( (m) => m.status === MachineStatus.AVAILABLE);



        if(!machine)
            {
                return {
                    statusCode: HttpResponseCode.NOT_FOUND,
                    machine: undefined
                }
            }

        db.updateMachineStatus(machine.machineId, MachineStatus.AWAITING_DROPOFF);
        db.updateMachineJobId(machine.machineId, request.jobId)
                
        machine.status = MachineStatus.AWAITING_DROPOFF;
        machine.currentJobId = request.jobId;

        cache.put(machine.machineId, machine);
        
        return {
            statusCode: HttpResponseCode.OK,
            machine: machine
        };
    }

    /**
     * Retrieves the state of a specific machine.
     * It first checks the cache for the machine's data and, if not found, fetches it from the database.
     * @param request The request model containing the machine ID.
     * @returns A response model with the status code and the machine's state.
     */
    private handleGetMachine(request: GetMachineRequestModel): MachineResponseModel {
        // Your implementation here

        // const cache = DataCache.getInstance();
        const db = MachineStateTable.getInstance();
        let machine = this.cache.get(request.machineId);

        if(!machine)
        {
            machine = db.getMachine(request.machineId);

            if(machine)
                {
                    this.cache.put(request.machineId, machine);
                }
        }

        if(!machine)
            {
                return{
                    statusCode: HttpResponseCode.NOT_FOUND,
                    machine: undefined
                }
            }

        return {
            statusCode: HttpResponseCode.OK,
            machine: machine
        };
    }

    /**
     * Starts the cycle of a machine that is awaiting drop-off.
     * It validates the machine's status, calls the external Smart Machine API to start the cycle,
     * and updates the machine's status to RUNNING.
     * @param request The request model containing the machine ID.
     * @returns A response model with the status code and the updated machine's state.
     */
    private handleStartMachine(request: StartMachineRequestModel): MachineResponseModel {
        // Your implementation here
        const db = MachineStateTable.getInstance();
        let machine = this.cache.get(request.machineId);

        if(!machine)
            {
                machine = db.getMachine(request.machineId);
                if(machine)
                    {
                        this.cache.put(machine.machineId, machine);
                    }
            }

        if(!machine)
            {
                return{
                    statusCode: HttpResponseCode.NOT_FOUND,
                    machine: undefined
                }
            }

        if(machine.status != MachineStatus.AWAITING_DROPOFF)
            {
                return{
                    statusCode: HttpResponseCode.BAD_REQUEST,
                    machine: machine
                }
            }
        
        const start_machine = SmartMachineClient.getInstance();

        try
        {

            start_machine.startCycle(machine.machineId);

        }catch
        {
            return{
                statusCode: HttpResponseCode.HARDWARE_ERROR,
                machine: undefined
            }
        }

        machine.status = MachineStatus.RUNNING;
        db.updateMachineStatus(machine.machineId, MachineStatus.RUNNING);
        this.cache.put(machine.machineId, machine);

        return {
            statusCode: HttpResponseCode.OK,
            machine: machine
        };
    }

    /**
     * The main entry point for handling all API requests.
     * It validates the token and routes the request to the appropriate private handler based on the method and path.
     * @param request The incoming request model.
     * @returns A response model from one of the specific handlers, or an error response.
     */
    public handle(request: RequestModel) {
        this.checkToken(request.token);

        if (request.method === 'POST' && request.path === '/machine/request') {
            return this.handleRequestMachine(request as RequestMachineRequestModel);
        }

        const getMachineMatch = request.path.match(/^\/machine\/([a-zA-Z0-9-]+)$/);
        if (request.method === 'GET' && getMachineMatch) {
            const machineId = getMachineMatch[1];
            const getRequest = { ...request, machineId } as GetMachineRequestModel;
            return this.handleGetMachine(getRequest);
        }

        const startMachineMatch = request.path.match(/^\/machine\/([a-zA-Z0-9-]+)\/start$/);
        if (request.method === 'POST' && startMachineMatch) { 
            const machineId = startMachineMatch[1];
            const startRequest = { ...request, machineId } as StartMachineRequestModel;
            return this.handleStartMachine(startRequest);
        }

        return { statusCode: HttpResponseCode.INTERNAL_SERVER_ERROR, machine: null };
    }
    
}